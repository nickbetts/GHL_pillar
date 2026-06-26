(function () {
  function fmt(data) {
    return JSON.stringify(data, null, 2);
  }

  function getLogKey(eventType) {
    return 'webhookLogs:' + eventType;
  }

  function loadLogs(eventType) {
    try {
      var raw = localStorage.getItem(getLogKey(eventType));
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function saveLogs(eventType, logs) {
    localStorage.setItem(getLogKey(eventType), JSON.stringify(logs.slice(0, 30)));
  }

  function renderLogs(eventType, container) {
    var logs = loadLogs(eventType);
    if (!logs.length) {
      container.innerHTML = '<div class="log-empty">No test runs yet for this webhook.</div>';
      return;
    }

    var html = logs
      .map(function (item) {
        var statusClass = item.status >= 200 && item.status < 300 ? 'status-good' : 'status-bad';
        var summary = item.summary || '';
        return (
          '<div class="log-row">' +
          '<div>' + item.time + '</div>' +
          '<div class="' + statusClass + '">' + item.status + '</div>' +
          '<div>' + summary.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>' +
          '</div>'
        );
      })
      .join('');

    container.innerHTML = html;
  }

  function safeParse(value) {
    try {
      return { ok: true, data: JSON.parse(value) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  window.initWebhookLab = function initWebhookLab(config) {
    var payloadEl = document.getElementById('payload');
    var sendBtn = document.getElementById('sendWebhook');
    var resetBtn = document.getElementById('resetPayload');
    var clearBtn = document.getElementById('clearLogs');
    var responseEl = document.getElementById('response');
    var logsEl = document.getElementById('logs');
    var statusEl = document.getElementById('runStatus');

    payloadEl.value = fmt(config.defaultPayload);
    renderLogs(config.eventType, logsEl);

    resetBtn.addEventListener('click', function () {
      payloadEl.value = fmt(config.defaultPayload);
    });

    clearBtn.addEventListener('click', function () {
      localStorage.removeItem(getLogKey(config.eventType));
      renderLogs(config.eventType, logsEl);
    });

    sendBtn.addEventListener('click', async function () {
      var parsed = safeParse(payloadEl.value);
      if (!parsed.ok) {
        statusEl.innerHTML = '<span class="status-bad">Invalid JSON:</span> ' + parsed.error;
        return;
      }

      statusEl.textContent = 'Sending test payload...';

      try {
        var res = await fetch('/api/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        });

        var text = await res.text();
        var summary = text.length > 180 ? text.slice(0, 180) + '...' : text;
        var now = new Date();
        var ts = now.toLocaleString();

        responseEl.textContent = text;
        statusEl.innerHTML =
          (res.ok ? '<span class="status-good">Success</span>' : '<span class="status-bad">Error</span>') +
          ' HTTP ' +
          res.status;

        var logs = loadLogs(config.eventType);
        logs.unshift({ time: ts, status: res.status, summary: summary });
        saveLogs(config.eventType, logs);
        renderLogs(config.eventType, logsEl);
      } catch (err) {
        statusEl.innerHTML = '<span class="status-bad">Request failed:</span> ' + err.message;
      }
    });
  };
})();
