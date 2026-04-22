import { handleUpload } from "@vercel/blob/client";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "image/*",
  "text/*",
];

function createJsonResponse(payload, status = 200, response) {
  if (response) {
    return response.status(status).json(payload);
  }

  return Response.json(payload, { status });
}

async function readRequestBody(request) {
  if (typeof request.json === "function") {
    return request.json();
  }

  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  if (typeof request.body === "string") {
    return JSON.parse(request.body);
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function getRequestUrl(request) {
  if (request.url?.startsWith("http")) {
    return request.url;
  }

  const protocol = request.headers?.["x-forwarded-proto"] || request.headers?.get?.("x-forwarded-proto") || "https";
  const host = request.headers?.host || request.headers?.get?.("host");
  return host ? `${protocol}://${host}${request.url || "/api/upload"}` : undefined;
}

function parseClientPayload(clientPayload) {
  if (!clientPayload) return {};

  try {
    return JSON.parse(clientPayload);
  } catch {
    throw new Error("Invalid upload metadata.");
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return createJsonResponse({ error: "Method not allowed." }, 405, response);
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return createJsonResponse(
      { error: "Missing BLOB_READ_WRITE_TOKEN. Add it in Vercel Project Settings > Environment Variables." },
      500,
      response
    );
  }

  try {
    const body = await readRequestBody(request);
    const requestForBlob = typeof request.json === "function" ? request : new Request(getRequestUrl(request), {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    });

    const jsonResponse = await handleUpload({
      body,
      request: requestForBlob,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!pathname || !pathname.startsWith("documents/")) {
          throw new Error("Invalid upload destination.");
        }

        const metadata = parseClientPayload(clientPayload);

        if (!metadata.title || !metadata.filename) {
          throw new Error("Document title and filename are required.");
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_FILE_SIZE,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            title: metadata.title,
            category: metadata.category || "Other",
            notes: metadata.notes || "",
            filename: metadata.filename,
            size: metadata.size || 0,
          }),
        };
      },
      onUploadCompleted: async () => {
        return;
      },
    });

    return createJsonResponse(jsonResponse, 200, response);
  } catch (error) {
    return createJsonResponse(
      { error: error.message || "Vercel Blob upload token could not be generated." },
      400,
      response
    );
  }
}
