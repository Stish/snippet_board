const STORAGE_KEY = "snippets";

const form = document.getElementById("snippetForm");
const toggleFormButton = document.getElementById("toggleFormButton");
const titleInput = document.getElementById("titleInput");
const createTagInput = document.getElementById("createTagInput");
const createValuesList = document.getElementById("createValuesList");
const addCreateValueButton = document.getElementById("addCreateValueButton");
const searchInput = document.getElementById("searchInput");
const tagFilterSelect = document.getElementById("tagFilterSelect");
const sortSelect = document.getElementById("sortSelect");
const tagSuggestions = document.getElementById("tagSuggestions");
const exportButton = document.getElementById("exportButton");
const importButton = document.getElementById("importButton");
const deleteAllButton = document.getElementById("deleteAllButton");
const deleteAllConfirm = document.getElementById("deleteAllConfirm");
const deleteAllYesButton = document.getElementById("deleteAllYesButton");
const deleteAllNoButton = document.getElementById("deleteAllNoButton");
const importFileInput = document.getElementById("importFileInput");
const transferStatus = document.getElementById("transferStatus");
const snippetList = document.getElementById("snippetList");
const emptyState = document.getElementById("emptyState");
let editingSnippetId = null;
let pendingDeleteAll = false;
const shownValues = new Set();
const pendingCreateDeleteIds = new Set();
let createValuesState = [];
let transferStatusTimerId = null;

function newLocalId() {
  return Date.now() + Math.floor(Math.random() * 1000000);
}

function valueKey(snippetId, valueId) {
  return `${snippetId}:${valueId}`;
}

function normalizeTag(rawTag) {
  if (typeof rawTag !== "string") {
    return "";
  }
  return rawTag.trim();
}

function normalizeValues(rawSnippet) {
  if (Array.isArray(rawSnippet?.values)) {
    const values = rawSnippet.values
      .map((rawValue, index) => {
        const text = typeof rawValue?.text === "string" ? rawValue.text.trim() : "";
        if (!text) {
          return null;
        }

        return {
          id: Number.isFinite(rawValue?.id) ? rawValue.id : newLocalId() + index,
          text,
          hideValue: Boolean(rawValue?.hideValue)
        };
      })
      .filter(Boolean);

    if (values.length > 0) {
      return values;
    }
  }

  const legacyContent = typeof rawSnippet?.content === "string" ? rawSnippet.content.trim() : "";
  if (!legacyContent) {
    return [];
  }

  const stableLegacyId = Number.isFinite(rawSnippet?.createdAt)
    ? (Number(rawSnippet.createdAt) * 10) + 1
    : newLocalId();

  return [
    {
      id: stableLegacyId,
      text: legacyContent,
      hideValue: Boolean(rawSnippet?.hideValue)
    }
  ];
}

function normalizeSnippet(rawSnippet, fallbackCreatedAt) {
  const title = typeof rawSnippet?.title === "string" ? rawSnippet.title.trim() : "";
  const values = normalizeValues(rawSnippet);
  const tag = normalizeTag(rawSnippet?.tag);

  if (!title || values.length === 0) {
    return null;
  }

  const createdAt = Number.isFinite(rawSnippet?.createdAt)
    ? rawSnippet.createdAt
    : fallbackCreatedAt;

  return {
    title,
    tag,
    values,
    createdAt
  };
}

function collectKnownTags(snippets) {
  return Array.from(
    new Set(
      snippets
        .map((snippet) => normalizeTag(snippet.tag))
        .filter((tag) => tag.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function renderTagControls(snippets) {
  const tags = collectKnownTags(snippets);

  tagSuggestions.textContent = "";
  tags.forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    tagSuggestions.append(option);
  });

  const currentFilter = tagFilterSelect.value;
  tagFilterSelect.textContent = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "Tag: All";
  tagFilterSelect.append(allOption);

  tags.forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    tagFilterSelect.append(option);
  });

  const hasCurrentFilter = currentFilter && tags.includes(currentFilter);
  tagFilterSelect.value = hasCurrentFilter ? currentFilter : "";
}

function ensureUniqueIds(snippets) {
  const snippetIdSet = new Set();

  return snippets.map((snippet) => {
    let snippetId = Number(snippet.createdAt);
    if (!Number.isFinite(snippetId)) {
      snippetId = newLocalId();
    }
    while (snippetIdSet.has(snippetId)) {
      snippetId += 1;
    }
    snippetIdSet.add(snippetId);

    const valueIdSet = new Set();
    const values = snippet.values.map((value) => {
      let valueId = Number(value.id);
      if (!Number.isFinite(valueId)) {
        valueId = newLocalId();
      }
      while (valueIdSet.has(valueId)) {
        valueId += 1;
      }
      valueIdSet.add(valueId);

      return {
        ...value,
        id: valueId
      };
    });

    return {
      ...snippet,
      createdAt: snippetId,
      values
    };
  });
}

function createEditorValueItem(value, options) {
  const row = document.createElement("div");
  row.className = "value-editor-item";

  const valueInput = document.createElement("textarea");
  valueInput.rows = 3;
  valueInput.placeholder = "Value text";
  valueInput.value = value.text;
  valueInput.required = true;

  const actionsRow = document.createElement("div");
  actionsRow.className = "value-editor-actions";

  const optionRow = document.createElement("label");
  optionRow.className = "option-row";

  const hideCheckbox = document.createElement("input");
  hideCheckbox.type = "checkbox";
  hideCheckbox.checked = Boolean(value.hideValue);

  const optionText = document.createElement("span");
  optionText.textContent = "Hide by default";

  optionRow.append(hideCheckbox, optionText);

  if (options.isDeletePending) {
    actionsRow.classList.add("is-confirming");
    const confirmText = document.createElement("span");
    confirmText.className = "confirm-text";
    confirmText.textContent = "Delete?";

    const yesButton = document.createElement("button");
    yesButton.type = "button";
    yesButton.className = "confirm-btn";
    yesButton.textContent = "Yes";
    yesButton.addEventListener("click", options.onConfirmRemove);

    const noButton = document.createElement("button");
    noButton.type = "button";
    noButton.className = "confirm-btn";
    noButton.textContent = "No";
    noButton.addEventListener("click", options.onCancelRemove);

    actionsRow.append(optionRow, confirmText, yesButton, noButton);
  } else {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-value-btn";
    removeButton.textContent = "🗑️";
    removeButton.title = "Remove value";
    removeButton.setAttribute("aria-label", "Remove value");
    removeButton.addEventListener("click", options.onRequestRemove);
    actionsRow.append(optionRow, removeButton);
  }

  row.append(valueInput, actionsRow);

  return {
    row,
    readValue: () => ({
      id: value.id,
      text: valueInput.value.trim(),
      hideValue: hideCheckbox.checked
    })
  };
}
function renderCreateValueEditors() {
  createValuesList.textContent = "";

  createValuesState.forEach((value, index) => {
    const editor = createEditorValueItem(value, {
      isDeletePending: pendingCreateDeleteIds.has(value.id),
      onRequestRemove: () => {
        syncCreateValuesStateFromDom();
        if (createValuesState.length <= 1) {
          return;
        }
        pendingCreateDeleteIds.add(value.id);
        renderCreateValueEditors();
      },
      onConfirmRemove: () => {
        syncCreateValuesStateFromDom();
        if (createValuesState.length <= 1) {
          return;
        }
        createValuesState.splice(index, 1);
        pendingCreateDeleteIds.delete(value.id);
        renderCreateValueEditors();
      },
      onCancelRemove: () => {
        pendingCreateDeleteIds.delete(value.id);
        renderCreateValueEditors();
      }
    });

    createValuesList.append(editor.row);
  });
}

      function collectCreateValues() {
        const valueRows = Array.from(createValuesList.querySelectorAll(".value-editor-item"));

        return valueRows
          .map((row, index) => {
            const textInput = row.querySelector("textarea");
            const hideInput = row.querySelector('input[type="checkbox"]');
            return {
              id: createValuesState[index]?.id ?? newLocalId(),
              text: textInput?.value.trim() ?? "",
              hideValue: hideInput?.checked ?? false
            };
          })
          .filter((value) => value.text.length > 0);
      }

      function syncCreateValuesStateFromDom() {
        const valueRows = Array.from(createValuesList.querySelectorAll(".value-editor-item"));
        createValuesState = valueRows.map((row, index) => {
          const textInput = row.querySelector("textarea");
          const hideInput = row.querySelector('input[type="checkbox"]');
          return {
            id: createValuesState[index]?.id ?? newLocalId(),
            text: textInput?.value ?? "",
            hideValue: hideInput?.checked ?? false
          };
        });

        const activeIds = new Set(createValuesState.map((value) => value.id));
        Array.from(pendingCreateDeleteIds).forEach((id) => {
          if (!activeIds.has(id)) {
            pendingCreateDeleteIds.delete(id);
          }
        });
      }

      function resetCreateFormState() {
        pendingCreateDeleteIds.clear();
        createValuesState = [{ id: newLocalId(), text: "", hideValue: false }];
        renderCreateValueEditors();
      }

      function setTransferStatus(message, isError = false) {
        if (transferStatusTimerId) {
          clearTimeout(transferStatusTimerId);
          transferStatusTimerId = null;
        }

        transferStatus.textContent = message;
        transferStatus.classList.toggle("error", isError);

        if (!message) {
          return;
        }

        transferStatusTimerId = setTimeout(() => {
          transferStatus.textContent = "";
          transferStatus.classList.remove("error");
          transferStatusTimerId = null;
        }, isError ? 5000 : 3000);
      }

      function renderDeleteAllConfirmation() {
        deleteAllConfirm.classList.toggle("hidden", !pendingDeleteAll);
      }

      async function getSnippets() {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const rawSnippets = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
        const normalizedSnippets = rawSnippets
          .map((snippet, index) => normalizeSnippet(snippet, newLocalId() + index))
          .filter(Boolean);

        return ensureUniqueIds(normalizedSnippets);
      }

      async function saveSnippets(snippets) {
        await chrome.storage.local.set({ [STORAGE_KEY]: snippets });
      }

      function createSnippetElement(snippet, index, snippets) {
        const item = document.createElement("li");
        item.className = "snippet-item";
        if (editingSnippetId === snippet.createdAt) {
          item.classList.add("is-editing");
        }

        const headerRow = document.createElement("div");
        headerRow.className = "snippet-header";

        const title = document.createElement("h2");
        title.className = "snippet-title";
        title.textContent = snippet.title;

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "edit-inline-btn";
        editButton.title = "Edit snippet";
        editButton.setAttribute("aria-label", "Edit snippet");
        editButton.textContent = "✏️";
        editButton.addEventListener("click", async () => {
          if (editingSnippetId === snippet.createdAt) {
            editingSnippetId = null;
          } else {
            editingSnippetId = snippet.createdAt;
          }
          await renderSnippets();
        });

        headerRow.append(title, editButton);

        let tagLabel = null;
        if (snippet.tag) {
          tagLabel = document.createElement("p");
          tagLabel.className = "snippet-tag";
          tagLabel.textContent = `#${snippet.tag}`;
        }

        const valuesContainer = document.createElement("div");
        valuesContainer.className = "snippet-values";

        snippet.values.forEach((value) => {
          const row = document.createElement("div");
          row.className = "snippet-value-item";

          const content = document.createElement("p");
          content.className = "snippet-content";

          const isValueShown = !value.hideValue || shownValues.has(valueKey(snippet.createdAt, value.id));
          content.textContent = isValueShown ? value.text : "***";

          const visibilityButton = document.createElement("button");
          visibilityButton.type = "button";
          visibilityButton.className = "value-visibility-btn";

          if (value.hideValue) {
            visibilityButton.textContent = isValueShown ? "🙈" : "👁";
            visibilityButton.title = isValueShown ? "Hide value" : "Show value";
            visibilityButton.setAttribute("aria-label", isValueShown ? "Hide value" : "Show value");
            visibilityButton.addEventListener("click", () => {
              const key = valueKey(snippet.createdAt, value.id);
              const nextShown = !shownValues.has(key);

              if (nextShown) {
                shownValues.add(key);
              } else {
                shownValues.delete(key);
              }

              content.textContent = nextShown ? value.text : "***";
              visibilityButton.textContent = nextShown ? "🙈" : "👁";
              visibilityButton.title = nextShown ? "Hide value" : "Show value";
              visibilityButton.setAttribute("aria-label", nextShown ? "Hide value" : "Show value");
              visibilityButton.blur();
            });
          } else {
            visibilityButton.classList.add("is-placeholder");
            visibilityButton.tabIndex = -1;
            visibilityButton.setAttribute("aria-hidden", "true");
            visibilityButton.textContent = "·";
          }

          const copyButton = document.createElement("button");
          copyButton.type = "button";
          copyButton.className = "value-copy-btn";
          copyButton.title = "Copy value";
          copyButton.setAttribute("aria-label", "Copy value");
          copyButton.textContent = "📋";
          copyButton.addEventListener("click", async () => {
            await navigator.clipboard.writeText(value.text);
            copyButton.textContent = "✓";
            setTimeout(() => {
              copyButton.textContent = "📋";
            }, 800);
            copyButton.blur();
          });

          row.append(content, visibilityButton, copyButton);
          valuesContainer.append(row);
        });

        let editForm = null;
        if (editingSnippetId === snippet.createdAt) {
          editForm = document.createElement("form");
          editForm.className = "edit-form";

          const editTitleInput = document.createElement("input");
          editTitleInput.type = "text";
          editTitleInput.maxLength = 80;
          editTitleInput.required = true;
          editTitleInput.value = snippet.title;
          editTitleInput.placeholder = "Snippet title";

          const editTagInput = document.createElement("input");
          editTagInput.type = "text";
          editTagInput.maxLength = 40;
          editTagInput.placeholder = "Tag (optional)";
          editTagInput.value = snippet.tag ?? "";
          editTagInput.setAttribute("list", "tagSuggestions");

          const editValuesList = document.createElement("div");
          editValuesList.className = "value-editor-list";

          let editValuesState = snippet.values.map((value) => ({ ...value }));
          const pendingEditDeleteIds = new Set();

          const syncEditValuesStateFromDom = () => {
            const rows = Array.from(editValuesList.querySelectorAll(".value-editor-item"));
            editValuesState = rows.map((row, valueIndex) => {
              const textInput = row.querySelector("textarea");
              const hideInput = row.querySelector('input[type="checkbox"]');
              return {
                id: editValuesState[valueIndex]?.id ?? newLocalId(),
                text: textInput?.value ?? "",
                hideValue: hideInput?.checked ?? false
              };
            });

            const activeIds = new Set(editValuesState.map((value) => value.id));
            Array.from(pendingEditDeleteIds).forEach((id) => {
              if (!activeIds.has(id)) {
                pendingEditDeleteIds.delete(id);
              }
            });
          };

          const renderEditValues = () => {
            editValuesList.textContent = "";

            editValuesState.forEach((value, valueIndex) => {
              const editor = createEditorValueItem(value, {
                isDeletePending: pendingEditDeleteIds.has(value.id),
                onRequestRemove: () => {
                  syncEditValuesStateFromDom();
                  if (editValuesState.length <= 1) {
                    return;
                  }
                  pendingEditDeleteIds.add(value.id);
                  renderEditValues();
                },
                onConfirmRemove: () => {
                  syncEditValuesStateFromDom();
                  if (editValuesState.length <= 1) {
                    return;
                  }
                  editValuesState.splice(valueIndex, 1);
                  pendingEditDeleteIds.delete(value.id);
                  renderEditValues();
                },
                onCancelRemove: () => {
                  pendingEditDeleteIds.delete(value.id);
                  renderEditValues();
                }
              });

              editValuesList.append(editor.row);
            });
          };

          renderEditValues();

          const addEditValueButton = document.createElement("button");
          addEditValueButton.type = "button";
          addEditValueButton.textContent = "+ Add value";
          addEditValueButton.addEventListener("click", () => {
            syncEditValuesStateFromDom();
            editValuesState.push({ id: newLocalId(), text: "", hideValue: false });
            renderEditValues();
          });

          const editActions = document.createElement("div");
          editActions.className = "edit-actions";

          const saveButton = document.createElement("button");
          saveButton.type = "submit";
          saveButton.textContent = "Save";

          const cancelButton = document.createElement("button");
          cancelButton.type = "button";
          cancelButton.textContent = "Cancel";
          cancelButton.addEventListener("click", async () => {
            editingSnippetId = null;
            await renderSnippets();
          });

          editActions.append(saveButton, cancelButton);

          const deleteSection = document.createElement("div");
          deleteSection.className = "edit-delete-section";

          const deleteSnippetButton = document.createElement("button");
          deleteSnippetButton.type = "button";
          deleteSnippetButton.className = "danger-btn";
          deleteSnippetButton.textContent = "Delete snippet";

          const deleteConfirmRow = document.createElement("div");
          deleteConfirmRow.className = "confirm-inline hidden";

          const deleteConfirmText = document.createElement("span");
          deleteConfirmText.textContent = "Delete snippet?";

          const deleteYesButton = document.createElement("button");
          deleteYesButton.type = "button";
          deleteYesButton.className = "confirm-btn";
          deleteYesButton.textContent = "Yes";
          deleteYesButton.addEventListener("click", async () => {
            snippets.splice(index, 1);
            snippet.values.forEach((value) => shownValues.delete(valueKey(snippet.createdAt, value.id)));
            editingSnippetId = null;
            await saveSnippets(snippets);
            await renderSnippets();
          });

          const deleteNoButton = document.createElement("button");
          deleteNoButton.type = "button";
          deleteNoButton.className = "confirm-btn";
          deleteNoButton.textContent = "No";
          deleteNoButton.addEventListener("click", () => {
            deleteConfirmRow.classList.add("hidden");
          });

          deleteSnippetButton.addEventListener("click", () => {
            deleteConfirmRow.classList.remove("hidden");
          });

          deleteConfirmRow.append(deleteConfirmText, deleteYesButton, deleteNoButton);
          deleteSection.append(deleteSnippetButton, deleteConfirmRow);

          editForm.append(editTitleInput, editTagInput, editValuesList, addEditValueButton, editActions, deleteSection);

          editForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            const nextTitle = editTitleInput.value.trim();
            const nextTag = normalizeTag(editTagInput.value);
            const valueRows = Array.from(editValuesList.querySelectorAll(".value-editor-item"));
            const nextValues = valueRows
              .map((row, valueIndex) => {
                const textInput = row.querySelector("textarea");
                const hideInput = row.querySelector('input[type="checkbox"]');
                return {
                  id: editValuesState[valueIndex]?.id ?? newLocalId(),
                  text: textInput?.value.trim() ?? "",
                  hideValue: hideInput?.checked ?? false
                };
              })
              .filter((value) => value.text.length > 0);

            if (!nextTitle || nextValues.length === 0) {
              return;
            }

            snippets[index] = {
              ...snippets[index],
              title: nextTitle,
              tag: nextTag,
              values: nextValues
            };

            snippet.values.forEach((value) => shownValues.delete(valueKey(snippet.createdAt, value.id)));
            editingSnippetId = null;
            await saveSnippets(snippets);
            await renderSnippets();
          });
        }

        item.append(headerRow);
        if (tagLabel) {
          item.append(tagLabel);
        }
        item.append(valuesContainer);
        if (editForm) {
          item.append(editForm);
        }

        return item;
      }

async function renderSnippets() {
  const snippets = await getSnippets();
  renderTagControls(snippets);
  const query = searchInput.value.trim().toLowerCase();
  const selectedTag = tagFilterSelect.value;
  const direction = sortSelect.value;

  const filteredSnippets = snippets.filter((snippet) => {
    const matchesQuery = snippet.title.toLowerCase().includes(query);
    const matchesTag = !selectedTag || snippet.tag === selectedTag;
    return matchesQuery && matchesTag;
  });

  filteredSnippets.sort((left, right) => {
    const compareResult = left.title.localeCompare(right.title, undefined, {
      sensitivity: "base"
    });
    return direction === "za" ? -compareResult : compareResult;
  });

  snippetList.textContent = "";

  if (!snippets.some((snippet) => snippet.createdAt === editingSnippetId)) {
    editingSnippetId = null;
  }

  const existingIds = new Set(snippets.map((snippet) => snippet.createdAt));
  Array.from(shownValues).forEach((key) => {
    const [snippetIdPart, valueIdPart] = key.split(":");
    const snippetId = Number(snippetIdPart);
    const valueId = Number(valueIdPart);
    const snippet = snippets.find((entry) => entry.createdAt === snippetId);

    if (!existingIds.has(snippetId) || !snippet?.values.some((value) => value.id === valueId)) {
      shownValues.delete(key);
    }
  });

  filteredSnippets.forEach((snippet) => {
    const originalIndex = snippets.findIndex(
      (storedSnippet) => storedSnippet.createdAt === snippet.createdAt
    );
    snippetList.append(createSnippetElement(snippet, originalIndex, snippets));
  });

  emptyState.style.display = filteredSnippets.length === 0 ? "block" : "none";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = titleInput.value.trim();
  const tag = normalizeTag(createTagInput.value);
  const values = collectCreateValues();

  if (!title || values.length === 0) {
    return;
  }

  const snippets = await getSnippets();
  snippets.unshift({
    title,
    tag,
    values,
    createdAt: newLocalId()
  });
  await saveSnippets(snippets);

  form.reset();
  resetCreateFormState();
  form.classList.add("hidden");
  toggleFormButton.focus();
  await renderSnippets();
});

toggleFormButton.addEventListener("click", () => {
  form.classList.toggle("hidden");
  if (!form.classList.contains("hidden")) {
    titleInput.focus();
  }
});

addCreateValueButton.addEventListener("click", () => {
  syncCreateValuesStateFromDom();
  createValuesState.push({ id: newLocalId(), text: "", hideValue: false });
  renderCreateValueEditors();
});

searchInput.addEventListener("input", () => {
  renderSnippets();
});

tagFilterSelect.addEventListener("change", () => {
  renderSnippets();
});

sortSelect.addEventListener("change", () => {
  renderSnippets();
});

exportButton.addEventListener("click", async () => {
  const snippets = await getSnippets();
  const payload = JSON.stringify(snippets, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const safeTimestamp = now.toISOString().replace(/[:.]/g, "-");
  const filename = `snippet-board-${safeTimestamp}.json`;

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  setTransferStatus(`Exported ${snippets.length} snippet(s).`);
});

importButton.addEventListener("click", () => {
  importFileInput.click();
});

deleteAllButton.addEventListener("click", () => {
  pendingDeleteAll = true;
  renderDeleteAllConfirmation();
});

deleteAllNoButton.addEventListener("click", () => {
  pendingDeleteAll = false;
  renderDeleteAllConfirmation();
});

deleteAllYesButton.addEventListener("click", async () => {
  editingSnippetId = null;
  pendingDeleteAll = false;
  shownValues.clear();
  await saveSnippets([]);
  await renderSnippets();
  renderDeleteAllConfirmation();
  setTransferStatus("All snippets deleted.");
});

importFileInput.addEventListener("change", async () => {
  const [file] = importFileInput.files || [];
  if (!file) {
    return;
  }

  try {
    const fileContent = await file.text();
    const parsed = JSON.parse(fileContent);

    if (!Array.isArray(parsed)) {
      throw new Error("JSON root must be an array of snippets.");
    }

    const importedSnippets = parsed
      .map((entry, index) => normalizeSnippet(entry, newLocalId() + index))
      .filter(Boolean);

    if (importedSnippets.length === 0) {
      throw new Error("No valid snippets found in the selected file.");
    }

    const existingSnippets = await getSnippets();
    const mergedSnippets = ensureUniqueIds([
      ...importedSnippets,
      ...existingSnippets
    ]);

    editingSnippetId = null;
    shownValues.clear();
    await saveSnippets(mergedSnippets);
    await renderSnippets();

    setTransferStatus(`Imported ${importedSnippets.length} snippet(s).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    setTransferStatus(message, true);
  } finally {
    importFileInput.value = "";
  }
});

renderSnippets();
renderDeleteAllConfirmation();
resetCreateFormState();
