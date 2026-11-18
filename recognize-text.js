var JOBS_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
var POLL_INTERVAL_MS = 3000;
var POLL_TIMEOUT_MS = 45000;
var MIME_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp"
};

async function request(ctx, stage, descriptor) {
  try {
    return await ctx.http.request(descriptor);
  } catch (error) {
    if (error.code !== "HTTP_ERROR") throw error;
    var match = /^Provider returned HTTP (\d{3})$/.exec(error.message);
    if (!match) throw error;
    var status = match[1];
    var hint = "";
    if (stage !== "下载识别结果" && status === "403") {
      hint = "请在简约翻译「基本设置 → 禁用Origin名单」另起一行添加 https://paddleocr.aistudio-app.com 后重试。若已配置，请核对 AI Studio 令牌。";
    } else if (stage !== "下载识别结果" && status === "401") {
      hint = "请核对服务配置中的 AI Studio Access Token。";
    } else if (stage !== "下载识别结果" && status === "429") {
      hint = "请检查飞桨当日解析配额，稍后再试。";
    } else if (stage === "下载识别结果" && status === "403") {
      hint = "飞桨的结果链接拒绝访问。可重新发起识别获取新的结果链接。";
    }
    throw Object.assign(new Error(stage + "失败（HTTP " + status + "）。" + hint), {code: error.code});
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("飞桨返回的内容无法解析为 JSON。");
  }
}

function jobData(response) {
  var data = parseJson(response.body);
  if (data && (data.code == null || data.code === 0) &&
      data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
    return data.data;
  }
  var code = data && Number.isInteger(data.code) ? "（代码 " + data.code + "）" : "";
  throw new Error("飞桨未能处理这次请求" + code + "。");
}

function pausePolling(milliseconds) {
  return new Promise(function (resolve) {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      var signal = AbortSignal.timeout(milliseconds);
      signal.addEventListener("abort", function () { resolve(); }, {once: true});
    } else if (typeof setTimeout === "function") {
      setTimeout(resolve, milliseconds);
    } else {
      throw Object.assign(new Error("扩展的脚本环境无法等待飞桨排队。请更新浏览器和简约翻译后重试。"), {
        code: "POLL_DELAY_UNAVAILABLE"
      });
    }
  });
}

async function waitForResult(jobId, auth, ctx) {
  var deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    var response = await request(ctx, "查询 OCR 任务", {
      url: JOBS_URL + "/" + encodeURIComponent(jobId),
      auth: auth,
      method: "GET"
    });
    var job = jobData(response);
    if (job.state === "done") {
      return job.resultUrl && job.resultUrl.jsonUrl;
    }
    if (job.state === "failed") {
      throw new Error("飞桨 OCR 任务处理失败。");
    }
    if (job.state !== "pending" && job.state !== "running") {
      throw new Error("飞桨返回了未知的 OCR 任务状态。");
    }
    var remaining = deadline - Date.now();
    if (remaining > 0) {
      await pausePolling(Math.min(POLL_INTERVAL_MS, remaining));
    }
  }
  throw new Error("等待云端 OCR 结果超时。");
}

async function downloadResult(ctx, rawUrl) {
  // The host HTTP API parses the URL and enforces this instance's allowed origins.
  if (typeof rawUrl !== "string" || !/^https:\/\/[^/?#@\\\s]+(?:[/?#]|$)/i.test(rawUrl) ||
      /[\\\s\x00-\x1f\x7f]/.test(rawUrl)) {
    throw new Error("飞桨没有返回有效的 HTTPS 识别结果地址。");
  }
  try {
    return await request(ctx, "下载识别结果", {url: rawUrl, method: "GET"});
  } catch (error) {
    if (error.code === "NETWORK_DENIED") {
      var denied = /^Origin outside declared network scope: (https:\/\/[a-z0-9.\-:\[\]]+)$/i.exec(error.message);
      if (denied) {
        throw Object.assign(new Error("请核对飞桨的结果存储域名，再在服务配置的「其他结果下载域名」填写 " + denied[1] + "，保存后重试。"), {
          code: "RESULT_ORIGIN_REQUIRED"
        });
      }
    }
    throw error;
  }
}

function isPolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3 ||
      !poly.every(function (point) {
        return Array.isArray(point) && point.length === 2 &&
          Number.isFinite(point[0]) && Number.isFinite(point[1]);
      })) {
    return false;
  }
  var twiceArea = 0;
  for (var i = 0; i < poly.length; i++) {
    var next = poly[(i + 1) % poly.length];
    twiceArea += poly[i][0] * next[1] - poly[i][1] * next[0];
  }
  return Number.isFinite(twiceArea) && twiceArea !== 0;
}

function readItems(jsonl) {
  var items = [];
  for (var line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    var data = parseJson(line);
    var pages = data && data.result && data.result.ocrResults;
    if (!Array.isArray(pages)) {
      throw new Error("飞桨识别结果缺少 ocrResults。");
    }
    for (var page of pages) {
      var result = page && page.prunedResult;
      if (!result || !Array.isArray(result.rec_texts)) {
        throw new Error("飞桨识别结果缺少 rec_texts。");
      }
      for (var i = 0; i < result.rec_texts.length; i++) {
        var text = result.rec_texts[i];
        if (typeof text !== "string") {
          throw new Error("飞桨返回了无效的识别文字。");
        }
        if (!text.trim()) continue;
        var poly = result.rec_polys && result.rec_polys[i];
        if (!isPolygon(poly)) {
          throw new Error("飞桨未返回有效的文字位置。");
        }
        var item = {text: text, poly: poly};
        var confidence = result.rec_scores && result.rec_scores[i];
        if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) {
          item.confidence = confidence;
        }
        items.push(item);
      }
    }
  }
  if (!items.length) {
    throw new Error("这张图片没有识别到可用文字。");
  }
  return items;
}

exports.recognizeText = async function (input, config, ctx) {
  var extension = MIME_EXTENSIONS[input.image.mimeType];
  if (typeof extension !== "string") {
    throw new Error("请使用 PNG、JPEG 或 WebP 图片。");
  }
  var auth = {type: "bearer", secret: ctx.secrets.ref("apiKey")};
  var upload = await request(ctx, "提交 OCR 任务", {
    url: JOBS_URL,
    method: "POST",
    auth: auth,
    bodyType: "multipart",
    body: {
      file: {
        assetId: input.image.assetId,
        mimeType: input.image.mimeType,
        filename: "image" + extension
      },
      model: "PP-OCRv6",
      optionalPayload: JSON.stringify({
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useTextlineOrientation: false,
        visualize: false
      })
    }
  });
  var jobId = jobData(upload).jobId;
  if (typeof jobId !== "string" || !jobId.trim() || jobId === "." || jobId === "..") {
    throw Object.assign(new Error("飞桨提交响应缺少有效的 OCR 任务编号。"), {
      code: "INVALID_RESPONSE"
    });
  }
  var url = await waitForResult(jobId, auth, ctx);
  var response = await downloadResult(ctx, url);
  var items = readItems(response.body);
  return {
    text: items.map(function (item) { return item.text; }).join("\n"),
    format: "text",
    items: items
  };
};
