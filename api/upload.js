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

function sendJson(response, status, payload) {
  response.status(status).json(payload);
}

function getJsonBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  if (typeof request.body === "string") {
    return JSON.parse(request.body);
  }

  return {};
}

function parseMetadata(clientPayload) {
  if (!clientPayload) {
    return {};
  }

  try {
    return JSON.parse(clientPayload);
  } catch {
    throw new Error("Invalid upload metadata.");
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    sendJson(response, 500, { error: "Missing BLOB_READ_WRITE_TOKEN in Vercel environment variables." });
    return;
  }

  try {
    const body = getJsonBody(request);

    const jsonResponse = await handleUpload({
      body,
      request,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!pathname || !pathname.startsWith("documents/")) {
          throw new Error("Invalid upload destination.");
        }

        const metadata = parseMetadata(clientPayload);

        if (!metadata.title || !metadata.filename) {
          throw new Error("Document title and filename are required.");
        }

        return {
          access: "public",
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
    });

    sendJson(response, 200, jsonResponse);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Failed to generate Vercel Blob client upload token.",
    });
  }
}
