import { del, list, put } from "@vercel/blob";

const DOCUMENT_PREFIX = "documents/";
const METADATA_PREFIX = "document-metadata/";

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

function normalizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function createMetadataPathname(id) {
  return `${METADATA_PREFIX}${id}.json`;
}

function isDocumentPathname(pathname) {
  return typeof pathname === "string" && pathname.startsWith(DOCUMENT_PREFIX);
}

function isMetadataPathname(pathname) {
  return typeof pathname === "string" && pathname.startsWith(METADATA_PREFIX) && pathname.endsWith(".json");
}

async function getDocuments() {
  const result = await list({
    prefix: METADATA_PREFIX,
    limit: 1000,
  });

  const documents = await Promise.all(
    result.blobs.map(async (blob) => {
      try {
        const response = await fetch(blob.url, { cache: "no-store" });
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    })
  );

  return documents
    .filter(Boolean)
    .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
}

async function saveDocument(request) {
  const body = getJsonBody(request);
  const title = normalizeText(body.title);
  const category = normalizeText(body.category, "Other");
  const notes = normalizeText(body.notes);
  const filename = normalizeText(body.filename || body.original_name);
  const blob = body.blob || {};

  if (!title) {
    return { status: 400, payload: { error: "Document title is required." } };
  }

  if (!filename) {
    return { status: 400, payload: { error: "Filename is required." } };
  }

  if (!isDocumentPathname(blob.pathname)) {
    return { status: 400, payload: { error: "Uploaded file was not stored in the expected documents folder." } };
  }

  const id = crypto.randomUUID();
  const metadataPathname = createMetadataPathname(id);
  const uploadedAt = new Date().toISOString();

  const document = {
    id,
    title,
    category,
    notes,
    filename,
    original_name: filename,
    size: Number(body.size || 0),
    contentType: blob.contentType || "",
    uploaded_at: uploadedAt,
    url: blob.url,
    downloadUrl: blob.downloadUrl || blob.url,
    filePathname: blob.pathname,
    metadataPathname,
  };

  await put(metadataPathname, JSON.stringify(document, null, 2), {
    access: "public",
    contentType: "application/json",
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });

  return { status: 201, payload: document };
}

async function deleteDocument(request) {
  const body = getJsonBody(request);
  const metadataPathname = normalizeText(body.metadataPathname || (body.id ? createMetadataPathname(body.id) : ""));
  const filePathname = normalizeText(body.filePathname);

  if (!isMetadataPathname(metadataPathname)) {
    return { status: 400, payload: { error: "Valid metadata path is required." } };
  }

  if (filePathname && !isDocumentPathname(filePathname)) {
    return { status: 400, payload: { error: "Invalid document path." } };
  }

  const deleteTargets = [metadataPathname];
  if (filePathname) deleteTargets.push(filePathname);

  const results = await Promise.allSettled(deleteTargets.map((target) => del(target)));
  const failed = results.find((result) => result.status === "rejected");

  if (failed) {
    return { status: 500, payload: { error: "Document could not be fully deleted. Please try again." } };
  }

  return { status: 200, payload: { message: "Document deleted." } };
}

export default async function handler(request, response) {
  try {
    if (request.method === "GET") {
      sendJson(response, 200, await getDocuments());
      return;
    }

    if (request.method === "POST") {
      const result = await saveDocument(request);
      sendJson(response, result.status, result.payload);
      return;
    }

    if (request.method === "DELETE") {
      const result = await deleteDocument(request);
      sendJson(response, result.status, result.payload);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Document request failed." });
  }
}
