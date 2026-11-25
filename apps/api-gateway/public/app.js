const state = { cvs: [], jds: [], analyses: [], jdMode: 'text' };
const pageTitles = {
  dashboard: 'Tổng quan',
  cvs: 'Hồ sơ CV',
  jds: 'Mô tả công việc',
  analysis: 'Phân tích phù hợp'
};
const labels = {
  technical_skills: 'Kỹ năng chuyên môn',
  soft_skills: 'Kỹ năng mềm',
  experience: 'Kinh nghiệm',
  education: 'Học vấn',
  language: 'Ngôn ngữ',
  other: 'Yêu cầu khác'
};

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const formatDate = value => value ? new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Yêu cầu thất bại (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showAlert(message, type = 'error') {
  const alert = $('#global-alert');
  alert.textContent = message;
  alert.classList.toggle('success', type === 'success');
  alert.hidden = false;
  window.clearTimeout(showAlert.timer);
  showAlert.timer = window.setTimeout(() => { alert.hidden = true; }, 6500);
}

function setView(name) {
  if (!pageTitles[name]) return;
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
  document.querySelectorAll('[data-view-link]').forEach(link => link.classList.toggle('active', link.dataset.viewLink === name && link.classList.contains('nav-link')));
  $('#page-title').textContent = pageTitles[name];
  if (name === 'analysis') renderSelectors();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStatus(online) {
  $('#status-dot').classList.toggle('online', online);
  $('#status-dot').classList.toggle('offline', !online);
  $('#status-text').textContent = online ? 'API đang hoạt động' : 'Mất kết nối API';
}

async function refreshData(showErrors = true) {
  const endpoints = ['/api/cvs', '/api/jds', '/api/analyses'];
  const results = await Promise.allSettled(endpoints.map(endpoint => request(endpoint)));
  const connected = results.some(result => result.status === 'fulfilled');
  updateStatus(connected);
  if (results[0].status === 'fulfilled') state.cvs = results[0].value;
  if (results[1].status === 'fulfilled') state.jds = results[1].value;
  if (results[2].status === 'fulfilled') state.analyses = results[2].value;
  renderAll();
  if (showErrors && !connected) showAlert('Không kết nối được API. Hãy kiểm tra Docker Compose và thử tải lại.');
  else if (showErrors && results.some(result => result.status === 'rejected')) {
    const failure = results.find(result => result.status === 'rejected');
    showAlert(failure.reason.message || 'Một phần dữ liệu chưa tải được.');
  }
}

function renderAll() {
  $('#cv-stat').textContent = state.cvs.length;
  $('#jd-stat').textContent = state.jds.length;
  $('#cv-nav-count').textContent = state.cvs.length;
  $('#jd-nav-count').textContent = state.jds.length;
  $('#cv-list-count').textContent = state.cvs.length;
  $('#jd-list-count').textContent = state.jds.length;
  const scores = state.analyses.filter(item => item.status === 'COMPLETED' && item.result)
    .map(item => Number(item.result.matchScore)).filter(Number.isFinite);
  $('#analysis-stat').innerHTML = scores.length
    ? `${Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)}<small>%</small>`
    : '—<small>%</small>';
  $('#analysis-caption').textContent = scores.length ? `${scores.length} phân tích đã hoàn thành` : 'Chưa có phân tích';
  renderCvs();
  renderJds();
  renderSelectors();
  renderHistory();
}

function renderCvs() {
  const container = $('#cv-list');
  if (!state.cvs.length) {
    container.innerHTML = '<div class="empty-state">Chưa có CV nào.<br><span>Tải lên CV đầu tiên để bắt đầu.</span></div>';
    return;
  }
  container.innerHTML = state.cvs.map(cv => {
    const profile = cv.parsed_data || {};
    const skills = (profile.technicalSkills || []).flatMap(group => group.skills || []);
    const details = [
      cv.email ? `<div><strong>Email:</strong> ${escapeHtml(cv.email)}</div>` : '',
      cv.file_name ? `<div><strong>Tệp:</strong> ${escapeHtml(cv.file_name)}</div>` : '',
      cv.file_name ? `<div><a class="text-button" href="/api/cvs/${encodeURIComponent(cv.id)}/file">Tải file gốc ↓</a></div>` : '',
      `<div><strong>Phân tích:</strong> ${escapeHtml(cv.analysis_provider || 'heuristic')}</div>`,
      skills.length ? `<div class="tag-list">${skills.slice(0, 8).map(skill => `<span class="tag">${escapeHtml(skill)}</span>`).join('')}</div>` : '',
      cv.content ? `<div class="record-excerpt">${escapeHtml(cv.content.slice(0, 650))}${cv.content.length > 650 ? '…' : ''}</div>` : ''
    ].filter(Boolean).join('');
    return `<article class="record-card">
      <div class="record-top">
        <span class="record-icon">▤</span>
        <div class="record-title"><strong>${escapeHtml(cv.name || 'CV chưa đặt tên')}</strong><small>${escapeHtml(formatDate(cv.created_at))}${cv.personalInformation?.fullName ? ` · ${escapeHtml(cv.personalInformation.fullName)}` : ''}</small></div>
        <div class="record-actions"><button type="button" data-action="cv-details" data-id="${escapeHtml(cv.id)}">Chi tiết</button><button type="button" class="delete-button" data-action="delete-cv" data-id="${escapeHtml(cv.id)}" aria-label="Xóa CV">Xóa</button></div>
      </div>
      <div class="record-details" data-details="${escapeHtml(cv.id)}" hidden>${details || '<span>Chưa có thông tin trích xuất.</span>'}</div>
    </article>`;
  }).join('');
}

function renderJds() {
  const container = $('#jd-list');
  if (!state.jds.length) {
    container.innerHTML = '<div class="empty-state">Chưa có JD nào.<br><span>Lưu vị trí bạn muốn ứng tuyển.</span></div>';
    return;
  }
  container.innerHTML = state.jds.map(jd => {
    const requirements = Array.isArray(jd.extracted_requirements) ? jd.extracted_requirements : [];
    const badges = requirements.slice(0, 14).map(item =>
      `<span class="tag ${item.priority === 'nice_to_have' ? '' : 'must'}">${escapeHtml(item.name)}</span>`
    ).join('');
    return `<article class="record-card">
      <div class="record-top">
        <span class="record-icon jd">▧</span>
        <div class="record-title"><strong>${escapeHtml(jd.title)}</strong><small>${escapeHtml(jd.company || 'Chưa có tên công ty')} · ${escapeHtml(formatDate(jd.created_at))}</small></div>
        <div class="record-actions"><button type="button" data-action="jd-details" data-id="${escapeHtml(jd.id)}">Chi tiết</button><button type="button" class="delete-button" data-action="delete-jd" data-id="${escapeHtml(jd.id)}" aria-label="Xóa JD">Xóa</button></div>
      </div>
      <div class="record-details" data-details="${escapeHtml(jd.id)}" hidden>
        <div><strong>${requirements.length}</strong> yêu cầu · Phân tích: ${escapeHtml(jd.analysis_provider || 'heuristic')}</div>
        <div class="tag-list">${badges || '<span class="tag">Chưa trích xuất yêu cầu</span>'}</div>
        <div class="record-excerpt">${escapeHtml((jd.content || '').slice(0, 500))}${(jd.content || '').length > 500 ? '…' : ''}</div>
      </div>
    </article>`;
  }).join('');
}

function renderSelectors() {
  const cvSelect = $('#analysis-cv');
  const jdSelect = $('#analysis-jd');
  const oldCv = cvSelect.value;
  const oldJd = jdSelect.value;
  cvSelect.innerHTML = '<option value="">Chọn CV</option>' + state.cvs.map(cv =>
    `<option value="${escapeHtml(cv.id)}">${escapeHtml(cv.name || `CV #${cv.id}`)}</option>`
  ).join('');
  jdSelect.innerHTML = '<option value="">Chọn JD</option>' + state.jds.map(jd =>
    `<option value="${escapeHtml(jd.id)}">${escapeHtml(jd.title)}${jd.company ? ` · ${escapeHtml(jd.company)}` : ''}</option>`
  ).join('');
  if (state.cvs.some(cv => String(cv.id) === oldCv)) cvSelect.value = oldCv;
  if (state.jds.some(jd => String(jd.id) === oldJd)) jdSelect.value = oldJd;
  const canAnalyze = state.cvs.length > 0 && state.jds.length > 0;
  $('#analysis-placeholder').hidden = canAnalyze && !$('#analysis-result').hidden;
}

function renderHistory() {
  const container = $('#recent-analyses');
  const completed = state.analyses.filter(item => item.status === 'COMPLETED').slice(0, 4);
  if (!completed.length) {
    container.innerHTML = '<div class="empty-state compact">Chưa có phân tích nào. Hãy bắt đầu bằng CV và JD đầu tiên của bạn.</div>';
    return;
  }
  container.innerHTML = completed.map(item => {
    const cv = state.cvs.find(record => record.id === item.cv_id);
    const jd = state.jds.find(record => record.id === item.jd_id);
    return `<button type="button" class="history-row" data-action="open-analysis" data-id="${escapeHtml(item.id)}">
      <span class="history-avatar">◈</span>
      <span class="history-info"><strong>${escapeHtml(cv?.name || `CV #${item.cv_id}`)} <span class="crumb-separator">→</span> ${escapeHtml(jd?.title || `JD #${item.jd_id}`)}</strong><small>Phân tích #${escapeHtml(item.id)} · ${escapeHtml(formatDate(item.created_at))}</small></span>
      <span class="history-score">${escapeHtml(item.result?.matchScore ?? 0)}<small>%</small></span>
    </button>`;
  }).join('');
}

function renderRequirements(items, matched) {
  if (!items?.length) return '<div class="empty-state compact">Không có yêu cầu trong nhóm này.</div>';
  return items.map(item => `<div class="requirement-item">
    <strong>${escapeHtml(item.name)}</strong>
    <div class="requirement-meta"><span>${escapeHtml(labels[item.category] || item.category || 'Yêu cầu khác')}</span><span class="priority-pill ${item.priority === 'nice_to_have' ? 'nice' : ''}">${item.priority === 'nice_to_have' ? 'Nice-to-have' : 'Must-have'}</span></div>
  </div>`).join('');
}

function renderAnalysis(record) {
  const result = record.result;
  if (!result) {
    $('#analysis-result').hidden = true;
    $('#analysis-placeholder').hidden = false;
    return;
  }
  const score = Math.max(0, Math.min(100, Number(result.matchScore) || 0));
  const matched = result.matchedRequirements || (result.matchedSkills || []).map(name => ({ name, category: 'technical_skills', priority: 'must_have' }));
  const missing = result.missingRequirements || (result.missingSkills || []).map(name => ({ name, category: 'technical_skills', priority: 'must_have' }));
  const breakdownEntries = Object.entries(result.breakdown || {}).filter(([, value]) => value.total > 0);
  const breakdown = breakdownEntries.length
    ? breakdownEntries.map(([category, value]) => `<div class="breakdown-row"><span>${escapeHtml(labels[category] || category)}</span><span class="progress-track"><span class="progress-fill" style="width:${Math.max(0, Math.min(100, value.score || 0))}%"></span></span><span class="breakdown-score">${value.score ?? '—'}%</span></div>`).join('')
    : '<div class="empty-state compact">Chưa có dữ liệu phân loại để hiển thị.</div>';
  const recommendations = result.recommendations?.length
    ? `<ul class="recommendation-list">${result.recommendations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<div class="empty-state compact">Hồ sơ đã đáp ứng các yêu cầu được trích xuất.</div>';
  const cv = state.cvs.find(item => item.id === record.cv_id);
  const jd = state.jds.find(item => item.id === record.jd_id);
  $('#analysis-result').innerHTML = `
    <article class="score-panel">
      <div class="score-ring" style="--score:${score}"><div class="score-inner"><span class="score-number">${score}<small>%</small></span><span class="score-caption">ĐỘ PHÙ HỢP</span></div></div>
      <h2 class="score-title">${score >= 75 ? 'Rất có tiềm năng' : score >= 50 ? 'Đang trên đà phù hợp' : 'Cơ hội để phát triển'}</h2>
      <p class="score-subtitle">${escapeHtml(cv?.name || `CV #${record.cv_id}`)} · ${escapeHtml(jd?.title || `JD #${record.jd_id}`)}</p>
    </article>
    <div class="result-main">
      <article class="result-panel">
        <h3>Đối chiếu yêu cầu</h3><p class="result-caption">${matched.length} phù hợp · ${missing.length} cần bổ sung</p>
        <div class="requirements-grid">
          <div class="requirement-column matched-column"><h3><span>✓</span> Đã đáp ứng</h3>${renderRequirements(matched, true)}</div>
          <div class="requirement-column missing-column"><h3><span>!</span> Còn thiếu</h3>${renderRequirements(missing, false)}</div>
        </div>
      </article>
      <article class="result-panel"><h3>Mức độ theo nhóm</h3><div class="breakdown-list">${breakdown}</div></article>
      <article class="result-panel"><h3>Đề xuất cải thiện</h3>${recommendations}<p class="result-note">Nguồn đề xuất: ${escapeHtml(result.recommendationProvider || 'rule-based')}. ${escapeHtml(result.note || '')}</p></article>
    </div>`;
  $('#analysis-result').hidden = false;
  $('#analysis-placeholder').hidden = true;
}

function setBusy(button, busy, text) {
  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  }
}

function showChosenFile(input, display, allowedExtensions) {
  const file = input.files?.[0];
  if (!file) {
    display.textContent = '';
    return;
  }
  const extension = file.name.split('.').pop().toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    input.value = '';
    display.textContent = '';
    showAlert(`Định dạng .${extension} không được hỗ trợ.`);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    input.value = '';
    display.textContent = '';
    showAlert('Tệp vượt quá giới hạn 10 MB.');
    return;
  }
  display.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
}

document.addEventListener('click', async event => {
  const viewLink = event.target.closest('[data-view-link]');
  if (viewLink) {
    event.preventDefault();
    setView(viewLink.dataset.viewLink);
    return;
  }
  if (event.target.closest('#refresh-button, [data-refresh]')) {
    await refreshData();
    return;
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const { id } = action.dataset;
  if (action.dataset.action === 'cv-details' || action.dataset.action === 'jd-details') {
    const details = document.querySelector(`[data-details="${CSS.escape(id)}"]`);
    if (details) details.hidden = !details.hidden;
  } else if (action.dataset.action === 'delete-cv' || action.dataset.action === 'delete-jd') {
    const isCv = action.dataset.action === 'delete-cv';
    const kind = isCv ? 'CV' : 'JD';
    if (!window.confirm(`Bạn có chắc muốn xóa ${kind} này?`)) return;
    try {
      await request(`/api/${isCv ? 'cvs' : 'jds'}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshData(false);
      showAlert(`Đã xóa ${kind}.`, 'success');
    } catch (error) {
      showAlert(error.message);
    }
  } else if (action.dataset.action === 'open-analysis') {
    try {
      const record = await request(`/api/analyses/${encodeURIComponent(id)}`);
      setView('analysis');
      renderAnalysis(record);
      $('#analysis-cv').value = String(record.cv_id);
      $('#analysis-jd').value = String(record.jd_id);
    } catch (error) {
      showAlert(error.message);
    }
  }
});

$('#cv-file').addEventListener('change', event => showChosenFile(event.target, $('#cv-file-name'), ['pdf', 'docx']));
$('#jd-file').addEventListener('change', event => showChosenFile(event.target, $('#jd-file-name'), ['txt', 'pdf', 'docx']));

for (const [zoneSelector, inputSelector] of [['#cv-dropzone', '#cv-file'], ['.compact-dropzone', '#jd-file']]) {
  const zone = $(zoneSelector);
  for (const eventName of ['dragenter', 'dragover']) {
    zone.addEventListener(eventName, event => {
      event.preventDefault();
      zone.classList.add('drag-over');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    zone.addEventListener(eventName, event => {
      event.preventDefault();
      zone.classList.remove('drag-over');
    });
  }
  zone.addEventListener('drop', event => {
    const input = $(inputSelector);
    if (!event.dataTransfer.files.length) return;
    input.files = event.dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

$('#cv-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const file = $('#cv-file').files[0];
  if (!file) return showAlert('Hãy chọn một file CV PDF hoặc DOCX.');
  const formData = new FormData();
  formData.append('file', file);
  if ($('#cv-name').value.trim()) formData.append('name', $('#cv-name').value.trim());
  if ($('#cv-email').value.trim()) formData.append('email', $('#cv-email').value.trim());
  setBusy(button, true, 'Đang tải lên và phân tích…');
  try {
    const cv = await request('/api/cvs', { method: 'POST', body: formData });
    event.currentTarget.reset();
    $('#cv-file-name').textContent = '';
    await refreshData(false);
    showAlert(`Đã lưu "${cv.name}" và trích xuất dữ liệu CV.`, 'success');
  } catch (error) {
    showAlert(error.message);
  } finally {
    setBusy(button, false);
  }
});

document.querySelectorAll('[data-jd-mode]').forEach(button => button.addEventListener('click', () => {
  state.jdMode = button.dataset.jdMode;
  document.querySelectorAll('[data-jd-mode]').forEach(item => item.classList.toggle('active', item === button));
  $('#jd-text-mode').hidden = state.jdMode !== 'text';
  $('#jd-file-mode').hidden = state.jdMode !== 'file';
  $('#jd-content').required = state.jdMode === 'text';
  $('#jd-file').required = state.jdMode === 'file';
}));

$('#jd-content').addEventListener('input', event => {
  $('#jd-char-count').textContent = event.target.value.length;
});

$('#jd-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const title = $('#jd-title').value.trim();
  const company = $('#jd-company').value.trim();
  const options = { method: 'POST' };
  if (!title) return showAlert('Hãy nhập tên vị trí công việc.');
  if (state.jdMode === 'file') {
    const file = $('#jd-file').files[0];
    if (!file) return showAlert('Hãy chọn file TXT, PDF hoặc DOCX chứa JD.');
    const formData = new FormData();
    formData.append('title', title);
    if (company) formData.append('company', company);
    formData.append('file', file);
    options.body = formData;
  } else {
    const content = $('#jd-content').value.trim();
    if (content.length < 20) return showAlert('Nội dung JD cần tối thiểu 20 ký tự.');
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify({ title, company, content });
  }
  setBusy(button, true, 'Đang lưu và phân tích…');
  try {
    const jd = await request('/api/jds', options);
    event.currentTarget.reset();
    $('#jd-file-name').textContent = '';
    $('#jd-char-count').textContent = '0';
    if (state.jdMode === 'file') {
      $('#jd-file').required = true;
      $('#jd-content').required = false;
    }
    await refreshData(false);
    showAlert(`Đã lưu "${jd.title}" với ${jd.extracted_requirements?.length || 0} yêu cầu được trích xuất.`, 'success');
  } catch (error) {
    showAlert(error.message);
  } finally {
    setBusy(button, false);
  }
});

$('#analysis-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const cvId = Number($('#analysis-cv').value);
  const jdId = Number($('#analysis-jd').value);
  if (!cvId || !jdId) return showAlert('Hãy chọn cả CV và JD trước khi phân tích.');
  setBusy(button, true, 'Đang so sánh hồ sơ…');
  try {
    const record = await request('/api/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cvId, jdId })
    });
    await refreshData(false);
    setView('analysis');
    renderAnalysis(record);
    showAlert('Phân tích CV và JD đã hoàn tất.', 'success');
  } catch (error) {
    showAlert(error.message);
  } finally {
    setBusy(button, false);
  }
});

refreshData();
