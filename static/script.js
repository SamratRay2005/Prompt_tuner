// State Management
let detectedVariables = [];
let apiKeys = [];
let inputMode = 'manual'; // 'manual' or 'csv'
let csvParsedData = []; // Full parsed array of objects from PapaParse
let csvHeaders = [];
let resultsList = []; // List of all prompt runs in the session
let runIdCounter = 1;
let isKeysMasked = false;
let selectedRowIds = new Set();
let isRunningBatch = false;

// Concurrency queue parameter
const CONCURRENCY_LIMIT = 3;

// Default fallbacks for models
const FALLBACK_MODELS = {
    gemini: [
        'gemini-3.5-flash',
        'gemini-3.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-flash-lite',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-1.0-pro'
    ],
    groq: [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'gemma2-9b-it'
    ],
    mistral: [
        'mistral-large-latest',
        'mistral-small-latest',
        'open-mistral-nemo'
    ]
};

// DOM Elements
document.addEventListener('DOMContentLoaded', () => {
    const promptTemplate = document.getElementById('prompt-template');
    const systemPrompt = document.getElementById('system-prompt');
    const toggleSystemPromptBtn = document.getElementById('toggle-system-prompt');
    const systemPromptContainer = document.getElementById('system-prompt-container');
    const detectedVarsList = document.getElementById('detected-variables-list');
    
    const providerSelect = document.getElementById('provider-select');
    const apiKeysInput = document.getElementById('api-keys');
    const toggleKeysMaskBtn = document.getElementById('toggle-keys-mask');
    const modelSelect = document.getElementById('model-select');
    const modelStatusLabel = document.getElementById('model-status-label');
    const temperatureInput = document.getElementById('temperature-input');
    const tempValDisplay = document.getElementById('temp-val');
    const maxTokensInput = document.getElementById('max-tokens-input');
    
    const modeManualBtn = document.getElementById('mode-manual-btn');
    const modeCsvBtn = document.getElementById('mode-csv-btn');
    const manualInputPanel = document.getElementById('manual-input-panel');
    const csvInputPanel = document.getElementById('csv-input-panel');
    const manualFieldsContainer = document.getElementById('manual-fields-container');
    
    const dragDropZone = document.getElementById('drag-drop-zone');
    const csvFileInput = document.getElementById('csv-file-input');
    const csvValidationBox = document.getElementById('csv-validation-box');
    const csvPreviewContainer = document.getElementById('csv-preview-container');
    const csvPreviewTable = document.getElementById('csv-preview-table');
    
    const runTriggerBtn = document.getElementById('run-trigger');
    const clearResultsBtn = document.getElementById('clear-results');
    const exportCsvBtn = document.getElementById('export-csv');
    const rerunSelectedBtn = document.getElementById('rerun-selected');
    const rerunAllBtn = document.getElementById('rerun-all');
    const resultsTableBody = document.getElementById('table-body');
    const tableHeaders = document.getElementById('table-headers');
    
    const countTotal = document.getElementById('count-total');
    const countSuccess = document.getElementById('count-success');
    const countFailed = document.getElementById('count-failed');
    
    // Modal Elements
    const promptModal = document.getElementById('prompt-modal');
    const modalPromptContent = document.getElementById('modal-prompt-content');
    const modalTextareaContent = document.getElementById('modal-textarea-content');
    const closeModalBtn = document.getElementById('close-modal');
    const copyModalPromptBtn = document.getElementById('copy-modal-prompt');
    const saveModalPromptBtn = document.getElementById('save-modal-prompt');
    let activeModalText = '';
    let onSaveCallback = null;

    // Initialize Fallback Models immediately
    updateModelOptions();

    // 1. Prompt template variable detection
    ['input', 'paste'].forEach(eventName => {
        promptTemplate.addEventListener(eventName, () => {
            detectVariables();
            if (inputMode === 'manual') {
                renderManualFields();
            } else {
                validateCSVHeaders();
            }
        });
    });

    // Toggle System Prompt field
    toggleSystemPromptBtn.addEventListener('click', () => {
        systemPromptContainer.classList.toggle('collapsed');
        const icon = toggleSystemPromptBtn.querySelector('i');
        if (systemPromptContainer.classList.contains('collapsed')) {
            icon.className = 'fa-solid fa-chevron-down';
        } else {
            icon.className = 'fa-solid fa-chevron-up';
        }
    });

    function detectVariables() {
        const text = promptTemplate.value;
        const regex = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
        let matches = [];
        let match;
        
        while ((match = regex.exec(text)) !== null) {
            matches.push(match[1]);
        }
        
        // De-duplicate
        detectedVariables = [...new Set(matches)];
        
        // Render Variable Chips
        detectedVarsList.innerHTML = '';
        if (detectedVariables.length === 0) {
            detectedVarsList.innerHTML = '<span class="empty-chips-placeholder">No variables detected yet. Write {...} in prompt.</span>';
        } else {
            detectedVariables.forEach(v => {
                const chip = document.createElement('span');
                chip.className = 'var-chip';
                chip.innerText = `{${v}}`;
                detectedVarsList.appendChild(chip);
            });
        }
    }


    // 2. Sidebar configuration and model fetching
    providerSelect.addEventListener('change', () => {
        updateModelOptions();
        fetchModelsFromServer();
        try {
            localStorage.setItem('prompt_tuner_provider', providerSelect.value);
        } catch (e) {
            console.warn(e);
        }
    });

    apiKeysInput.addEventListener('input', () => {
        parseKeys();
        fetchModelsFromServer();
        try {
            localStorage.setItem('prompt_tuner_keys', apiKeysInput.value);
        } catch (e) {
            console.warn(e);
        }
    });

    toggleKeysMaskBtn.addEventListener('click', () => {
        isKeysMasked = !isKeysMasked;
        if (isKeysMasked) {
            apiKeysInput.classList.add('masked');
            toggleKeysMaskBtn.innerHTML = '<i class="fa-solid fa-eye"></i> Show Keys';
        } else {
            apiKeysInput.classList.remove('masked');
            toggleKeysMaskBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Mask Keys';
        }
    });

    temperatureInput.addEventListener('input', (e) => {
        tempValDisplay.innerText = e.target.value;
        try {
            localStorage.setItem('prompt_tuner_temp', e.target.value);
        } catch (err) {
            console.warn(err);
        }
    });

    maxTokensInput.addEventListener('input', (e) => {
        try {
            localStorage.setItem('prompt_tuner_max_tokens', e.target.value);
        } catch (err) {
            console.warn(err);
        }
    });

    modelSelect.addEventListener('change', () => {
        try {
            localStorage.setItem('prompt_tuner_model', modelSelect.value);
        } catch (e) {
            console.warn(e);
        }
    });

    function parseKeys() {
        const text = apiKeysInput.value;
        apiKeys = text.split('\n')
            .map(k => k.trim())
            .filter(k => k.length > 0);
    }

    function updateModelOptions(modelsArray = null) {
        const provider = providerSelect.value;
        modelSelect.innerHTML = '';
        
        const models = modelsArray || FALLBACK_MODELS[provider] || [];
        models.forEach(model => {
            const opt = document.createElement('option');
            opt.value = model;
            opt.innerText = model;
            modelSelect.appendChild(opt);
        });

        // Try restoring model from localStorage
        try {
            const savedModel = localStorage.getItem('prompt_tuner_model');
            if (savedModel && models.includes(savedModel)) {
                modelSelect.value = savedModel;
            }
        } catch (e) {
            console.warn(e);
        }
    }

    let fetchDebounce = null;
    function fetchModelsFromServer() {
        if (fetchDebounce) clearTimeout(fetchDebounce);
        
        const provider = providerSelect.value;
        parseKeys();
        
        if (apiKeys.length === 0) {
            updateModelOptions();
            modelStatusLabel.innerText = "Fallback List";
            modelStatusLabel.className = "model-status fallback";
            return;
        }

        fetchDebounce = setTimeout(async () => {
            modelStatusLabel.innerText = "Loading...";
            modelStatusLabel.className = "model-status loading";
            
            const firstKey = apiKeys[0];
            try {
                const response = await fetch('/api/models', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ provider: provider, key: firstKey })
                });
                if (!response.ok) {
                    throw new Error(`Server returned ${response.status}`);
                }
                const data = await response.json();
                if (data.models && data.models.length > 0) {
                    updateModelOptions(data.models);
                    modelStatusLabel.innerText = "Fetched";
                    modelStatusLabel.className = "model-status fetched";
                } else {
                    throw new Error("No models returned");
                }
            } catch (err) {
                console.warn("Failed to fetch models from API, keeping fallback list:", err);
                updateModelOptions(); // restore fallbacks
                modelStatusLabel.innerText = "Fallback List";
                modelStatusLabel.className = "model-status fallback";
            }
        }, 500);
    }

    // 3. Input Mode Toggle & Manual Render
    modeManualBtn.addEventListener('click', () => {
        inputMode = 'manual';
        modeManualBtn.classList.add('active');
        modeCsvBtn.classList.remove('active');
        manualInputPanel.classList.remove('hidden');
        csvInputPanel.classList.add('hidden');
        renderManualFields();
        updateRunButtonState();
    });

    modeCsvBtn.addEventListener('click', () => {
        inputMode = 'csv';
        modeManualBtn.classList.remove('active');
        modeCsvBtn.classList.add('active');
        manualInputPanel.classList.add('hidden');
        csvInputPanel.classList.remove('hidden');
        validateCSVHeaders();
        updateRunButtonState();
    });

    function renderManualFields() {
        manualFieldsContainer.innerHTML = '';
        if (detectedVariables.length === 0) {
            manualFieldsContainer.innerHTML = '<p class="no-vars-msg">No variables found in template. Prompt will run static.</p>';
            return;
        }

        detectedVariables.forEach(v => {
            const fg = document.createElement('div');
            fg.className = 'form-group';
            
            const label = document.createElement('label');
            label.innerText = v;
            label.setAttribute('for', `val-${v}`);
            
            const input = document.createElement('input');
            input.type = 'text';
            input.id = `val-${v}`;
            input.placeholder = `Value for {${v}}`;
            
            fg.appendChild(label);
            fg.appendChild(input);
            manualFieldsContainer.appendChild(fg);
        });
    }

    // 4. CSV Import & Drag and Drop
    ['dragenter', 'dragover'].forEach(eventName => {
        dragDropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dragDropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragDropZone.classList.remove('dragover');
        }, false);
    });

    dragDropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            csvFileInput.files = files;
            handleCsvSelected(files[0]);
        }
    });

    csvFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleCsvSelected(e.target.files[0]);
        }
    });

    function handleCsvSelected(file) {
        if (!file.name.endsWith('.csv')) {
            showCsvValidation(false, "Invalid File Type: Please upload a .csv file.");
            csvParsedData = [];
            csvHeaders = [];
            updateRunButtonState();
            return;
        }

        Papa.parse(file, {
            header: true,
            skipEmptyLines: 'greedy',
            complete: function(results) {
                if (results.errors && results.errors.length > 0) {
                    showCsvValidation(false, `Malformed CSV: ${results.errors[0].message}`);
                    csvParsedData = [];
                    csvHeaders = [];
                    updateRunButtonState();
                    return;
                }
                
                csvHeaders = results.meta.fields || [];
                csvParsedData = results.data || [];
                validateCSVHeaders();
            },
            error: function(err) {
                showCsvValidation(false, `CSV Parsing Error: ${err.message}`);
                csvParsedData = [];
                csvHeaders = [];
                updateRunButtonState();
            }
        });
    }

    function validateCSVHeaders() {
        if (inputMode !== 'csv') return;
        if (csvHeaders.length === 0 && csvParsedData.length === 0) {
            hideCsvValidation();
            updateRunButtonState();
            return;
        }

        // Compare detectedVariables and csvHeaders
        const templateSet = new Set(detectedVariables);
        const csvSet = new Set(csvHeaders);

        const missingInCsv = detectedVariables.filter(v => !csvSet.has(v));
        const extraInCsv = csvHeaders.filter(h => !templateSet.has(h));

        if (missingInCsv.length > 0) {
            let errorMsg = '<strong>Header Mismatch Error:</strong><br>';
            errorMsg += `• Missing in CSV (needed by template): <code>${missingInCsv.join(', ')}</code><br>`;
            showCsvValidation(false, errorMsg);
            csvPreviewContainer.classList.add('hidden');
        } else {
            let successMsg = `<strong>Validation Success:</strong> CSV contains all template variables! Detected ${csvParsedData.length} test rows.`;
            if (extraInCsv.length > 0) {
                successMsg += ` (Unused CSV columns: <code>${extraInCsv.join(', ')}</code>)`;
            }
            showCsvValidation(true, successMsg);
            renderCsvPreview();
        }
        updateRunButtonState();
    }

    function showCsvValidation(isValid, message) {
        csvValidationBox.classList.remove('hidden', 'success', 'error');
        csvValidationBox.classList.add(isValid ? 'success' : 'error');
        csvValidationBox.innerHTML = message;
    }

    function hideCsvValidation() {
        csvValidationBox.classList.add('hidden');
        csvPreviewContainer.classList.add('hidden');
    }

    function renderCsvPreview() {
        const thead = csvPreviewTable.querySelector('thead');
        const tbody = csvPreviewTable.querySelector('tbody');
        thead.innerHTML = '';
        tbody.innerHTML = '';

        if (csvParsedData.length === 0) return;

        // Render headers
        const hr = document.createElement('tr');
        csvHeaders.forEach(h => {
            const th = document.createElement('th');
            th.innerText = h;
            hr.appendChild(th);
        });
        thead.appendChild(hr);

        // Render preview rows (max 3)
        const previewRows = csvParsedData.slice(0, 3);
        previewRows.forEach(row => {
            const tr = document.createElement('tr');
            csvHeaders.forEach(h => {
                const td = document.createElement('td');
                td.innerText = row[h] !== undefined ? row[h] : '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        csvPreviewContainer.classList.remove('hidden');
    }

    function updateRunButtonState() {
        const promptVal = promptTemplate.value.trim();
        parseKeys();
        
        let isDisabled = false;

        if (!promptVal) {
            isDisabled = true;
        } else if (inputMode === 'csv') {
            // Check if csv headers contain all template variables
            const csvSet = new Set(csvHeaders);
            const missingInCsv = detectedVariables.filter(v => !csvSet.has(v));
            
            if (csvParsedData.length === 0 || missingInCsv.length > 0) {
                isDisabled = true;
            }
        }

        runTriggerBtn.disabled = isDisabled;
        
        // Update tooltip hint if disabled
        if (isDisabled) {
            if (!promptVal) {
                runTriggerBtn.title = "Please write a prompt template first.";
            } else if (inputMode === 'csv' && csvParsedData.length === 0) {
                runTriggerBtn.title = "Please upload a valid CSV file.";
            } else {
                runTriggerBtn.title = "Ensure CSV headers match template variables.";
            }
        } else {
            runTriggerBtn.title = "";
        }
        
        updateRerunButtonsState();
    }

    // Watch keys input and prompt value changes for enabling run button
    promptTemplate.addEventListener('input', updateRunButtonState);
    apiKeysInput.addEventListener('input', updateRunButtonState);

    // 5. Execution Orchestration (Manual & Batch Concurrency Queue)
    runTriggerBtn.addEventListener('click', () => {
        if (inputMode === 'manual') {
            addManualRow();
        } else {
            addBatchRows();
        }
    });

    rerunSelectedBtn.addEventListener('click', reRunSelectedRows);
    rerunAllBtn.addEventListener('click', reRunAllRows);

    // Hydration utility
    function hydratePrompt(template, variables, valuesMap) {
        let hydrated = template;
        variables.forEach(v => {
            const val = valuesMap[v] !== undefined ? valuesMap[v] : '';
            // Match all instances of {v} and replace
            const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp('{' + escapeRegExp(v) + '}', 'g');
            hydrated = hydrated.replace(regex, val);
        });
        // Unescape double braces {{ and }} to { and } to emulate Python's .format() behavior
        hydrated = hydrated.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
        return hydrated;
    }

    // Manual run
    // Manual add
    function addManualRow() {
        const template = promptTemplate.value;
        const sysPrompt = systemPrompt.value;
        
        // Collect manual inputs
        const valuesMap = {};
        detectedVariables.forEach(v => {
            const inputEl = document.getElementById(`val-${v}`);
            valuesMap[v] = inputEl ? inputEl.value : '';
        });

        const hydrated = hydratePrompt(template, detectedVariables, valuesMap);
        
        const runId = runIdCounter++;
        const newResult = {
            id: runId,
            inputs: { ...valuesMap },
            hydratedPrompt: hydrated,
            systemPrompt: sysPrompt,
            status: 'idle',
            output: 'Not run yet',
            keyIndexUsed: null
        };

        resultsList.push(newResult);
        renderResultsTable();
    }

    // Batch add
    function addBatchRows() {
        const template = promptTemplate.value;
        const sysPrompt = systemPrompt.value;
        
        // Build result item for each row in csvParsedData
        csvParsedData.forEach(row => {
            const hydrated = hydratePrompt(template, detectedVariables, row);
            const runId = runIdCounter++;
            const newResult = {
                id: runId,
                inputs: { ...row },
                hydratedPrompt: hydrated,
                systemPrompt: sysPrompt,
                status: 'idle',
                output: 'Not run yet',
                keyIndexUsed: null
            };
            resultsList.push(newResult);
        });

        renderResultsTable();
    }

    // Task Runner with Concurrency Limit
    async function runTasksWithConcurrency(tasks, limit) {
        let taskIndex = 0;
        const executeNext = async () => {
            while (taskIndex < tasks.length) {
                const currentIdx = taskIndex++;
                try {
                    await tasks[currentIdx]();
                } catch (err) {
                    console.error("Queue execution error:", err);
                }
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(limit, tasks.length); i++) {
            workers.push(executeNext());
        }

        await Promise.all(workers);
    }

    // Re-run single row
    async function reRunSingleRow(resultId) {
        const item = resultsList.find(r => r.id === resultId);
        if (!item || isRunningBatch) return;

        const template = promptTemplate.value;
        const sysPrompt = systemPrompt.value;
        item.hydratedPrompt = hydratePrompt(template, detectedVariables, item.inputs);
        item.systemPrompt = sysPrompt;

        item.status = 'running';
        item.output = 'Retrying prompt...';
        item.keyIndexUsed = null;
        renderResultsTable();

        isRunningBatch = true;
        updateRunButtonState();

        await executeApiCall(item);
        
        isRunningBatch = false;
        updateRunButtonState();
        updateRowUI(item);
        updateMetaCounters();
    }

    // Delete single row
    function deleteRow(resultId) {
        if (isRunningBatch) return;
        resultsList = resultsList.filter(r => r.id !== resultId);
        selectedRowIds.delete(resultId);
        renderResultsTable();
    }

    // Re-run selected rows
    async function reRunSelectedRows() {
        if (selectedRowIds.size === 0 || isRunningBatch) return;
        const itemsToRun = resultsList.filter(r => selectedRowIds.has(r.id));
        await executeBatchReRun(itemsToRun);
    }

    // Re-run all rows
    async function reRunAllRows() {
        if (resultsList.length === 0 || isRunningBatch) return;
        await executeBatchReRun(resultsList);
    }

    // Shared execution logic for re-running batch
    async function executeBatchReRun(items) {
        const template = promptTemplate.value;
        const sysPrompt = systemPrompt.value;
        
        isRunningBatch = true;
        updateRunButtonState();
        
        // Update states and UI
        items.forEach(item => {
            item.hydratedPrompt = hydratePrompt(template, detectedVariables, item.inputs);
            item.systemPrompt = sysPrompt;
            item.status = 'pending';
            item.output = 'Queued...';
            item.keyIndexUsed = null;
        });
        renderResultsTable();

        const tasks = items.map(item => async () => {
            item.status = 'running';
            item.output = 'Retrying prompt...';
            updateRowUI(item);
            
            await executeApiCall(item);
            updateRowUI(item);
            updateMetaCounters();
        });

        await runTasksWithConcurrency(tasks, CONCURRENCY_LIMIT);

        isRunningBatch = false;
        updateRunButtonState();
    }

    function updateRerunButtonsState() {
        const hasKeys = apiKeys.length > 0;
        const hasPrompt = promptTemplate.value.trim().length > 0;
        const modelSelected = modelSelect.value;
        const executionAllowed = hasKeys && hasPrompt && modelSelected && !isRunningBatch;
        
        rerunAllBtn.disabled = !executionAllowed || resultsList.length === 0;
        rerunSelectedBtn.disabled = !executionAllowed || selectedRowIds.size === 0;
    }

    // API Caller
    async function executeApiCall(resultItem) {
        parseKeys();
        const provider = providerSelect.value;
        const model = modelSelect.value;
        const temperature = parseFloat(temperatureInput.value);
        const maxTokens = parseInt(maxTokensInput.value);

        try {
            const response = await fetch('/api/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    provider: provider,
                    model: model,
                    system_prompt: resultItem.systemPrompt,
                    prompt: resultItem.hydratedPrompt,
                    api_keys: apiKeys,
                    temperature: temperature,
                    max_tokens: maxTokens
                })
            });

            const data = await response.json();
            if (response.ok) {
                resultItem.status = 'success';
                resultItem.output = data.output || '(No response text)';
                resultItem.keyIndexUsed = data.key_index_used;
            } else {
                resultItem.status = 'error';
                resultItem.output = data.error || `Error: Server returned status ${response.status}`;
            }
        } catch (err) {
            resultItem.status = 'error';
            resultItem.output = `Network error: ${err.message}`;
        }
    }

    // 6. UI Rendering for Results Table
    function renderResultsTable() {
        resultsTableBody.innerHTML = '';
        
        if (resultsList.length === 0) {
            resultsTableBody.innerHTML = `
                <tr class="empty-table-row">
                    <td colspan="6" class="empty-table-message">
                        <i class="fa-solid fa-inbox empty-icon"></i>
                        <p>No runs yet. Enter values in the sidebar and click Run to begin.</p>
                    </td>
                </tr>`;
            clearResultsBtn.disabled = true;
            exportCsvBtn.disabled = true;
            updateMetaCounters();
            updateRerunButtonsState();
            return;
        }

        clearResultsBtn.disabled = false;
        exportCsvBtn.disabled = false;

        // Re-generate dynamic headers based on detected variables + input variables present in resultsList
        // This ensures table handles column shifts dynamically
        const allVarsInSession = new Set();
        resultsList.forEach(r => {
            Object.keys(r.inputs).forEach(k => allVarsInSession.add(k));
        });
        const varsArray = [...allVarsInSession];

        // Update headers row
        tableHeaders.innerHTML = '';
        
        const thSelect = document.createElement('th');
        thSelect.style.width = '40px';
        const selectAllCheckbox = document.createElement('input');
        selectAllCheckbox.type = 'checkbox';
        selectAllCheckbox.id = 'select-all-rows';
        selectAllCheckbox.checked = resultsList.length > 0 && resultsList.every(r => selectedRowIds.has(r.id));
        selectAllCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                resultsList.forEach(r => selectedRowIds.add(r.id));
            } else {
                selectedRowIds.clear();
            }
            renderResultsTable();
        });
        thSelect.appendChild(selectAllCheckbox);
        tableHeaders.appendChild(thSelect);

        const thId = document.createElement('th');
        thId.style.width = '60px';
        thId.innerText = 'ID';
        tableHeaders.appendChild(thId);

        // Inputs headers
        varsArray.forEach(v => {
            const th = document.createElement('th');
            th.innerText = v;
            tableHeaders.appendChild(th);
        });

        const thPrompt = document.createElement('th');
        thPrompt.innerText = 'Hydrated Prompt';
        tableHeaders.appendChild(thPrompt);

        const thOutput = document.createElement('th');
        thOutput.innerText = 'LLM Output';
        tableHeaders.appendChild(thOutput);

        const thAction = document.createElement('th');
        thAction.style.width = '80px';
        thAction.innerText = 'Action';
        tableHeaders.appendChild(thAction);

        // Render each row
        resultsList.forEach(item => {
            const tr = document.createElement('tr');
            tr.id = `row-${item.id}`;
            if (selectedRowIds.has(item.id)) {
                tr.classList.add('row-selected');
            }
            
            // 0. Select cell
            const tdSelect = document.createElement('td');
            const rowCheckbox = document.createElement('input');
            rowCheckbox.type = 'checkbox';
            rowCheckbox.checked = selectedRowIds.has(item.id);
            rowCheckbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedRowIds.add(item.id);
                    tr.classList.add('row-selected');
                } else {
                    selectedRowIds.delete(item.id);
                    tr.classList.remove('row-selected');
                }
                const master = document.getElementById('select-all-rows');
                if (master) {
                    master.checked = resultsList.every(r => selectedRowIds.has(r.id));
                }
                updateRerunButtonsState();
            });
            tdSelect.appendChild(rowCheckbox);
            tr.appendChild(tdSelect);

            // 1. ID cell
            const tdId = document.createElement('td');
            tdId.innerText = `#${item.id}`;
            tr.appendChild(tdId);

            // 2. Variable input cells
            varsArray.forEach(v => {
                const td = document.createElement('td');
                const val = item.inputs[v];
                if (val !== undefined) {
                    const container = document.createElement('div');
                    container.className = 'table-input-container';
                    
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'table-input-field';
                    input.value = val;
                    input.title = 'Edit value';
                    
                    const zoomBtn = document.createElement('button');
                    zoomBtn.className = 'table-zoom-btn';
                    zoomBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
                    zoomBtn.title = 'View/Edit in modal';
                    
                    zoomBtn.addEventListener('click', () => {
                        openPromptModal(input.value, `Value for {${v}} (Row #${item.id})`, 'Copy Value', (newVal) => {
                            input.value = newVal;
                            updateVal(newVal);
                        });
                    });
                    
                    function updateVal(newVal) {
                        item.inputs[v] = newVal;
                        const template = promptTemplate.value;
                        item.hydratedPrompt = hydratePrompt(template, detectedVariables, item.inputs);
                        
                        // Update Hydrated Prompt preview in DOM
                        const promptCell = tr.querySelector('.cell-prompt-preview div');
                        if (promptCell) {
                            promptCell.innerText = item.hydratedPrompt;
                        }
                    }
                    
                    input.addEventListener('input', (e) => {
                        updateVal(e.target.value);
                    });
                    
                    container.appendChild(input);
                    container.appendChild(zoomBtn);
                    td.appendChild(container);
                } else {
                    td.innerHTML = '<span class="text-muted">-</span>';
                }
                tr.appendChild(td);
            });

            // 3. Prompt preview cell
            const tdPrompt = document.createElement('td');
            tdPrompt.className = 'cell-prompt-preview';
            
            const promptWrapper = document.createElement('div');
            promptWrapper.className = 'prompt-text-truncate clickable';
            promptWrapper.title = 'Click to view full prompt';
            promptWrapper.innerText = item.hydratedPrompt;
            promptWrapper.addEventListener('click', () => openPromptModal(item.hydratedPrompt, 'Full Hydrated Prompt', 'Copy Prompt'));
            
            const expandBtn = document.createElement('button');
            expandBtn.className = 'btn-expand-preview';
            expandBtn.innerHTML = '<i class="fa-solid fa-maximize"></i> View full';
            expandBtn.addEventListener('click', () => openPromptModal(item.hydratedPrompt, 'Full Hydrated Prompt', 'Copy Prompt'));

            tdPrompt.appendChild(promptWrapper);
            tdPrompt.appendChild(expandBtn);
            tr.appendChild(tdPrompt);

            // 4. Output cell
            const tdOutput = document.createElement('td');
            tdOutput.className = 'cell-output-container';
            
            const outputBox = document.createElement('div');
            outputBox.className = 'output-text-box';
            
            if (item.status === 'idle') {
                outputBox.innerText = item.output;
                outputBox.classList.add('idle-status');
            } else if (item.status === 'running' || item.status === 'pending') {
                outputBox.classList.add('loading');
                outputBox.innerHTML = `<span class="spinner"></span> ${item.output}`;
            } else if (item.status === 'error') {
                outputBox.classList.add('error');
                outputBox.innerText = item.output;
                outputBox.classList.add('clickable');
                outputBox.title = "Click to view full output";
                outputBox.addEventListener('click', () => openPromptModal(item.output, 'Full LLM Output', 'Copy Output'));
            } else {
                outputBox.innerText = item.output;
                outputBox.classList.add('clickable');
                outputBox.title = "Click to view full output";
                outputBox.addEventListener('click', () => openPromptModal(item.output, 'Full LLM Output', 'Copy Output'));
            }

            tdOutput.appendChild(outputBox);

            // Key index used badge
            if (item.keyIndexUsed !== null && item.keyIndexUsed !== undefined && item.status === 'success') {
                const badge = document.createElement('span');
                badge.className = 'key-index-badge';
                badge.innerText = `Key #${item.keyIndexUsed}`;
                tdOutput.appendChild(badge);
            }

            // Quick Copy action
            if (item.status === 'success') {
                const actionsRow = document.createElement('div');
                actionsRow.className = 'output-actions-row';
                
                const copyBtn = document.createElement('button');
                copyBtn.className = 'btn-icon-action';
                copyBtn.title = 'Copy output';
                copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(item.output);
                    copyBtn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success);"></i> Copied';
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
                    }, 2000);
                });

                actionsRow.appendChild(copyBtn);
                tdOutput.appendChild(actionsRow);
            }

            tr.appendChild(tdOutput);

            // 5. Actions cell
            const tdAction = document.createElement('td');
            
            const rerunBtn = document.createElement('button');
            rerunBtn.className = 'btn btn-secondary btn-sm';
            rerunBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
            rerunBtn.title = 'Run this test row';
            
            if (item.status === 'running' || item.status === 'pending') {
                rerunBtn.disabled = true;
            }
            rerunBtn.addEventListener('click', () => reRunSingleRow(item.id));
            tdAction.appendChild(rerunBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-secondary btn-sm btn-delete-row';
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            deleteBtn.title = 'Delete this row';
            
            if (item.status === 'running' || item.status === 'pending') {
                deleteBtn.disabled = true;
            }
            deleteBtn.addEventListener('click', () => deleteRow(item.id));
            tdAction.appendChild(deleteBtn);

            tr.appendChild(tdAction);

            resultsTableBody.appendChild(tr);
        });

        updateMetaCounters();
        updateRerunButtonsState();
    }

    // Optimized Single Row updating to avoid re-rendering entire table in batch run
    function updateRowUI(item) {
        const rowEl = document.getElementById(`row-${item.id}`);
        if (!rowEl) {
            renderResultsTable();
            return;
        }

        // Find the cell representing output
        const outputCell = rowEl.querySelector('.cell-output-container');
        if (outputCell) {
            outputCell.innerHTML = '';
            
            const outputBox = document.createElement('div');
            outputBox.className = 'output-text-box';
            
            if (item.status === 'idle') {
                outputBox.innerText = item.output;
                outputBox.classList.add('idle-status');
                outputBox.classList.remove('clickable');
                outputBox.title = "";
                outputBox.onclick = null;
            } else if (item.status === 'running' || item.status === 'pending') {
                outputBox.classList.add('loading');
                outputBox.innerHTML = `<span class="spinner"></span> ${item.output}`;
                outputBox.classList.remove('clickable');
                outputBox.title = "";
                outputBox.onclick = null; // Remove old listener
            } else if (item.status === 'error') {
                outputBox.classList.add('error');
                outputBox.innerText = item.output;
                outputBox.classList.add('clickable');
                outputBox.title = "Click to view full output";
                outputBox.onclick = () => openPromptModal(item.output, 'Full Error Log', 'Copy Error');
            } else {
                outputBox.innerText = item.output;
                outputBox.classList.add('clickable');
                outputBox.title = "Click to view full output";
                outputBox.onclick = () => openPromptModal(item.output, 'Full LLM Output', 'Copy Output');
            }
            outputCell.appendChild(outputBox);

            // Append Key Badge
            if (item.keyIndexUsed !== null && item.keyIndexUsed !== undefined && item.status === 'success') {
                const badge = document.createElement('span');
                badge.className = 'key-index-badge';
                badge.innerText = `Key #${item.keyIndexUsed}`;
                outputCell.appendChild(badge);
            }

            // Quick Copy action
            if (item.status === 'success') {
                const actionsRow = document.createElement('div');
                actionsRow.className = 'output-actions-row';
                
                const copyBtn = document.createElement('button');
                copyBtn.className = 'btn-icon-action';
                copyBtn.title = 'Copy output';
                copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(item.output);
                    copyBtn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success);"></i> Copied';
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
                    }, 2000);
                });

                actionsRow.appendChild(copyBtn);
                outputCell.appendChild(actionsRow);
            }
        }

        // Disable or enable rerun/delete buttons based on state
        const actionCell = rowEl.lastElementChild;
        if (actionCell) {
            const buttons = actionCell.querySelectorAll('button');
            buttons.forEach(btn => {
                btn.disabled = (item.status === 'running' || item.status === 'pending');
            });
        }
    }

    function updateMetaCounters() {
        const total = resultsList.length;
        const success = resultsList.filter(r => r.status === 'success').length;
        const failed = resultsList.filter(r => r.status === 'error').length;

        countTotal.innerText = total;
        countSuccess.innerText = success;
        countFailed.innerText = failed;
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // 7. Prompt View Modal Overlay
    const modalTitle = document.getElementById('modal-title');
    const copyModalText = document.getElementById('copy-modal-text');
    
    function openPromptModal(text, title = 'Full View', copyText = 'Copy Text', onSave = null) {
        activeModalText = text;
        onSaveCallback = onSave;
        
        if (onSave) {
            modalPromptContent.classList.add('hidden');
            modalTextareaContent.classList.remove('hidden');
            modalTextareaContent.value = text;
            saveModalPromptBtn.classList.remove('hidden');
        } else {
            modalPromptContent.classList.remove('hidden');
            modalTextareaContent.classList.add('hidden');
            modalPromptContent.innerText = text;
            saveModalPromptBtn.classList.add('hidden');
        }
        
        if (modalTitle) modalTitle.innerText = title;
        if (copyModalText) copyModalText.innerText = copyText;
        promptModal.classList.remove('hidden');
    }

    function closeModal() {
        promptModal.classList.add('hidden');
        activeModalText = '';
        onSaveCallback = null;
        modalPromptContent.classList.remove('hidden');
        modalTextareaContent.classList.add('hidden');
        saveModalPromptBtn.classList.add('hidden');
    }

    closeModalBtn.addEventListener('click', closeModal);
    promptModal.addEventListener('click', (e) => {
        if (e.target === promptModal) closeModal();
    });

    saveModalPromptBtn.addEventListener('click', () => {
        if (onSaveCallback) {
            const newVal = modalTextareaContent.value;
            onSaveCallback(newVal);
            closeModal();
        }
    });

    copyModalPromptBtn.addEventListener('click', () => {
        const textToCopy = onSaveCallback ? modalTextareaContent.value : activeModalText;
        if (textToCopy !== undefined && textToCopy !== null) {
            navigator.clipboard.writeText(textToCopy);
            copyModalPromptBtn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success);"></i> Copied';
            setTimeout(() => {
                copyModalPromptBtn.innerHTML = onSaveCallback ? '<i class="fa-solid fa-copy"></i> Copy Text' : '<i class="fa-solid fa-copy"></i> Copy Prompt';
            }, 2000);
        }
    });

    // 8. Results Actions (Clear & Export)
    clearResultsBtn.addEventListener('click', () => {
        resultsList = [];
        runIdCounter = 1;
        selectedRowIds.clear();
        renderResultsTable();
    });

    exportCsvBtn.addEventListener('click', () => {
        if (resultsList.length === 0) return;

        // Build exporting objects
        const exportData = resultsList.map(item => {
            const rowObject = { ...item.inputs };
            rowObject['Hydrated Prompt'] = item.hydratedPrompt;
            rowObject['LLM Output'] = item.output;
            rowObject['Status'] = item.status;
            rowObject['Key Index Used'] = item.keyIndexUsed !== null ? item.keyIndexUsed : '';
            return rowObject;
        });

        const csvString = Papa.unparse(exportData);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `prompt-tuner-results-${timestamp}.csv`;

        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        
        if (navigator.msSaveBlob) { // IE 10+
            navigator.msSaveBlob(blob, filename);
        } else {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    });

    // Local Storage Prompt Templates (Nice to have)
    // Save prompt to localstorage automatically
    promptTemplate.addEventListener('blur', () => {
        try {
            localStorage.setItem('prompt_tuner_template', promptTemplate.value);
        } catch (e) {
            console.warn("localStorage setItem failed:", e);
        }
    });
    systemPrompt.addEventListener('blur', () => {
        try {
            localStorage.setItem('prompt_tuner_system', systemPrompt.value);
        } catch (e) {
            console.warn("localStorage setItem failed:", e);
        }
    });

    // Restoring template and settings from Local Storage
    try {
        const savedTemplate = localStorage.getItem('prompt_tuner_template');
        const savedSystem = localStorage.getItem('prompt_tuner_system');
        const savedKeys = localStorage.getItem('prompt_tuner_keys');
        const savedProvider = localStorage.getItem('prompt_tuner_provider');
        const savedTemp = localStorage.getItem('prompt_tuner_temp');
        const savedMaxTokens = localStorage.getItem('prompt_tuner_max_tokens');

        if (savedTemplate) {
            promptTemplate.value = savedTemplate;
            detectVariables();
            renderManualFields();
        }
        if (savedSystem) {
            systemPrompt.value = savedSystem;
        }
        if (savedProvider) {
            providerSelect.value = savedProvider;
        }
        if (savedKeys) {
            apiKeysInput.value = savedKeys;
            parseKeys();
        }
        if (savedTemp) {
            temperatureInput.value = savedTemp;
            tempValDisplay.innerText = savedTemp;
        }
        if (savedMaxTokens) {
            maxTokensInput.value = savedMaxTokens;
        }

        // Initialize models and trigger fetch
        updateModelOptions();
        fetchModelsFromServer();
    } catch (e) {
        console.warn("localStorage getItem failed:", e);
    }

    updateRunButtonState();
});
