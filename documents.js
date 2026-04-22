import { upload } from "@vercel/blob/client";

const uploadForm = document.querySelector("#uploadForm");
const dropZone = document.querySelector("#dropZone");
const fileInput = document.querySelector("#file");
const formMessage = document.querySelector("#formMessage");
const documentList = document.querySelector("#documentList");
const searchInput = document.querySelector("#searchInput");
const documentCount = document.querySelector("#documentCount");
const titleInput = document.querySelector("#title");
const categoryInput = document.querySelector("#category");
const notesInput = document.querySelector("#notes");

let documents = [];

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return "Unknown date";

  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanFileName(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function setMessage(message, type = "") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type ? `is-${type}` : ""}`;
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!contentType.includes("application/json")) {
    throw new Error("The server returned an unexpected response. Please redeploy the latest Vercel API routes.");
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error("The server response could not be read. Please try again.");
  }
}

function updateDropLabel() {
  const file = fileInput.files[0];
  const title = dropZone.querySelector("strong");
  const hint = dropZone.querySelector("small");

  if (!file) {
    title.textContent = "Drop your file here or click to browse";
    hint.textContent = "PDF, DOCX, PPTX, images, ZIP files, and other project materials";
    return;
  }

  title.textContent = file.name;
  hint.textContent = `${formatBytes(file.size)} selected`;
}

function renderDocuments() {
  const searchTerm = searchInput.value.trim().toLowerCase();
  const filtered = documents.filter((item) => {
    return [item.title, item.category, item.notes, item.filename, item.original_name]
      .join(" ")
      .toLowerCase()
      .includes(searchTerm);
  });

  documentCount.textContent = `${documents.length} ${documents.length === 1 ? "document" : "documents"}`;

  if (!filtered.length) {
    documentList.innerHTML = `
      <div class="empty-state">
        <strong>${documents.length ? "No matching documents" : "No documents yet"}</strong>
        <span>${documents.length ? "Try another search term." : "Upload your first project file to start building the vault."}</span>
      </div>
    `;
    return;
  }

  documentList.innerHTML = filtered
    .map((item) => {
      const title = escapeHtml(item.title);
      const notes = escapeHtml(item.notes || "No notes added.");
      const category = escapeHtml(item.category || "Other");
      const filename = escapeHtml(item.filename || item.original_name || "Document");
      const href = escapeHtml(item.downloadUrl || item.url || "#");

      return `
        <article class="document-item">
          <div class="document-meta">
            <strong>${title}</strong>
            <p>${notes}</p>
            <div class="document-tags">
              <span>${category}</span>
              <span>${filename}</span>
              <span>${formatBytes(item.size)}</span>
              <span>${formatDate(item.uploaded_at)}</span>
            </div>
          </div>
          <div class="document-actions">
            <a class="small-button" href="${href}" target="_blank" rel="noreferrer">Download</a>
            <button
              class="small-button delete"
              type="button"
              data-delete="${escapeHtml(item.id)}"
              data-file-pathname="${escapeHtml(item.filePathname)}"
              data-metadata-pathname="${escapeHtml(item.metadataPathname)}"
            >
              Delete
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadDocuments() {
  const response = await fetch("/api/documents", {
    headers: { Accept: "application/json" },
  });
  const result = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(result?.error || "Could not load documents.");
  }

  documents = Array.isArray(result) ? result : [];
  renderDocuments();
}

async function saveDocumentMetadata({ title, category, notes, file, blob }) {
  const response = await fetch("/api/documents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      title,
      category,
      notes,
      filename: file.name,
      size: file.size,
      blob,
    }),
  });

  const result = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(result?.error || "The file uploaded, but its library record could not be saved.");
  }

  return result;
}

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");

  if (event.dataTransfer.files.length) {
    fileInput.files = event.dataTransfer.files;
    updateDropLabel();
  }
});

fileInput.addEventListener("change", updateDropLabel);
searchInput.addEventListener("input", renderDocuments);

documentList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete]");
  if (!deleteButton) return;

  const confirmed = window.confirm("Delete this document from the vault?");
  if (!confirmed) return;

  deleteButton.disabled = true;

  try {
    const response = await fetch("/api/documents", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: deleteButton.dataset.delete,
        filePathname: deleteButton.dataset.filePathname,
        metadataPathname: deleteButton.dataset.metadataPathname,
      }),
    });

    const result = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(result?.error || "Could not delete the document.");
    }

    await loadDocuments();
  } catch (error) {
    window.alert(error.message);
    deleteButton.disabled = false;
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  const file = fileInput.files[0];
  const title = titleInput.value.trim();
  const category = categoryInput.value;
  const notes = notesInput.value.trim();
  const submitButton = uploadForm.querySelector("button[type='submit']");

  if (!file) {
    setMessage("Please choose a file to upload.", "error");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Uploading 0%";

  try {
    const safeName = cleanFileName(file.name);
    const pathname = `documents/${Date.now()}-${safeName}`;
    const payload = {
      title,
      category,
      notes,
      filename: file.name,
      size: file.size,
    };

    const blob = await upload(pathname, file, {
      access: "public",
      handleUploadUrl: "/api/upload",
      multipart: true,
      clientPayload: JSON.stringify(payload),
      onUploadProgress: ({ percentage }) => {
        submitButton.textContent = `Uploading ${Math.round(percentage)}%`;
      },
    });

    await saveDocumentMetadata({ title, category, notes, file, blob });

    uploadForm.reset();
    updateDropLabel();
    setMessage("Document uploaded successfully.", "success");
    await loadDocuments();
  } catch (error) {
    setMessage(error.message || "Upload failed. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Upload Document";
  }
});

loadDocuments().catch((error) => {
  documentList.innerHTML = `
    <div class="empty-state">
      <strong>Library unavailable</strong>
      <span>${escapeHtml(error.message)}</span>
    </div>
  `;
});
