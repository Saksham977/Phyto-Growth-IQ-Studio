/**
 * schemaReview.js
 * ---------------------------------------------------------------------------
 * Renders the editable schema-confirmation table: for each raw column, its
 * detected role (Dimension/Measure/Time-Period/Ignore) with a confidence
 * badge, plus a header-layout override and a primary-measure selector. This
 * is the human-in-the-loop step that makes auto-detection trustworthy on
 * arbitrary files — nothing here is auto-applied silently.
 *
 * Pure rendering, no state of its own (mirrors dashboard.js) — app.js owns
 * the current confirmed schema and passes it back in on every change. Every
 * edit triggers a full re-render (not partial DOM patching); at the realistic
 * column counts this app deals with, that's imperceptibly fast and removes
 * a whole class of "forgot to refresh X" bugs.
 * ---------------------------------------------------------------------------
 */

const PhytoSchemaReview = (() => {

  const ROLE_LABELS = {
    dimension: 'Dimension',
    measure: 'Measure',
    'time-period': 'Time-Period',
    ignore: 'Ignore',
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function buildHtml(schema) {
    const warningsHtml = schema.warnings.length
      ? `<div class="schema-review-warnings">${schema.warnings.map(w => `<div class="schema-warning-item">${escapeHtml(w)}</div>`).join('')}</div>`
      : '';

    const primaryMeasureHtml = schema.measureRegistry.length
      ? `
        <label class="schema-control">
          Primary measure
          <select class="primary-measure-select">
            ${schema.measureRegistry.map(m => `<option value="${escapeHtml(m.key)}" ${m.key === schema.primaryMeasureKey ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
          </select>
        </label>
      `
      : '';

    const rowsHtml = schema.columns.map(col => `
      <tr>
        <td class="col-label">
          ${escapeHtml(col.headerLabel)}
          ${col.sampleValues && col.sampleValues.length ? `<div class="schema-sample-values">e.g. ${col.sampleValues.map(escapeHtml).join(', ')}</div>` : ''}
        </td>
        <td>
          <select class="role-select" data-col-index="${col.colIndex}">
            ${Object.keys(ROLE_LABELS).map(r => `<option value="${r}" ${r === col.role ? 'selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}
          </select>
        </td>
        <td>
          <span class="confidence-badge confidence-${col.confidence}" title="${escapeHtml(col.reason)}">${col.confidence}</span>
        </td>
      </tr>
    `).join('');

    return `
      ${warningsHtml}
      <div class="schema-review-controls">
        <label class="schema-control">
          Header layout
          <select class="header-rows-select">
            <option value="1" ${schema.headerRowCount === 1 ? 'selected' : ''}>Single row</option>
            <option value="2" ${schema.headerRowCount === 2 ? 'selected' : ''}>Two rows (merged)</option>
          </select>
        </label>
        <label class="schema-control">
          Data starts at row
          <input type="number" class="data-start-input" min="1" value="${schema.dataStartRow + 1}">
        </label>
        ${primaryMeasureHtml}
      </div>
      <div class="table-wrap schema-review-table-wrap">
        <table class="data-table schema-review-table">
          <thead>
            <tr><th class="col-label">Column</th><th>Role</th><th>Confidence</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  function render(schema, containerId, onSchemaChange) {
    const el = document.getElementById(containerId);
    el.innerHTML = buildHtml(schema);

    el.querySelectorAll('.header-rows-select, .data-start-input').forEach(input => {
      input.addEventListener('change', () => {
        const headerRowCount = parseInt(el.querySelector('.header-rows-select').value, 10);
        const dataStartRow = parseInt(el.querySelector('.data-start-input').value, 10) - 1;
        const updated = PhytoSchema.applyUserEdits(schema, [], null, { headerRowCount, dataStartRow });
        render(updated, containerId, onSchemaChange);
        onSchemaChange(updated);
      });
    });

    el.querySelectorAll('.role-select, .primary-measure-select').forEach(input => {
      input.addEventListener('change', () => {
        const columnRoleOverrides = Array.from(el.querySelectorAll('.role-select')).map(sel => ({
          colIndex: parseInt(sel.dataset.colIndex, 10),
          role: sel.value,
        }));
        const primaryMeasureSelect = el.querySelector('.primary-measure-select');
        const primaryMeasureKeyOverride = primaryMeasureSelect ? primaryMeasureSelect.value : null;
        const updated = PhytoSchema.applyUserEdits(schema, columnRoleOverrides, primaryMeasureKeyOverride, null);
        render(updated, containerId, onSchemaChange);
        onSchemaChange(updated);
      });
    });
  }

  return { render };
})();
