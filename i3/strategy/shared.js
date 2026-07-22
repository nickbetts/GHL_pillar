(function () {
  var topBtn = document.querySelector('[data-back-to-top]');
  var dropdowns = Array.prototype.slice.call(document.querySelectorAll('.nav-dropdown'));

  function isDesktopNavMode() {
    return window.matchMedia('(min-width: 901px)').matches;
  }

  function closeAllDropdowns() {
    dropdowns.forEach(function (dropdown) {
      dropdown.classList.remove('is-open');
    });
  }

  function setupDropdowns() {
    if (!dropdowns.length) return;

    dropdowns.forEach(function (dropdown) {
      var trigger = dropdown.querySelector('a');
      if (!trigger) return;

      trigger.addEventListener('click', function (event) {
        if (!isDesktopNavMode()) return;

        var isOpen = dropdown.classList.contains('is-open');
        if (!isOpen) {
          event.preventDefault();
          closeAllDropdowns();
          dropdown.classList.add('is-open');
        }
      });
    });

    document.addEventListener('click', function (event) {
      if (!isDesktopNavMode()) return;
      if (event.target.closest('.nav-dropdown')) return;
      closeAllDropdowns();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeAllDropdowns();
      }
    });

    window.addEventListener('resize', function () {
      if (!isDesktopNavMode()) {
        closeAllDropdowns();
      }
    });
  }

  function writeToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      var helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.position = 'absolute';
      helper.style.left = '-9999px';
      document.body.appendChild(helper);
      helper.select();

      try {
        var copied = document.execCommand('copy');
        document.body.removeChild(helper);
        if (copied) {
          resolve();
          return;
        }
        reject(new Error('Copy command failed'));
      } catch (error) {
        document.body.removeChild(helper);
        reject(error);
      }
    });
  }

  function setupKeywordCopyButtons() {
    var copyButtons = Array.prototype.slice.call(document.querySelectorAll('[data-copy-keywords]'));
    if (!copyButtons.length) return;

    copyButtons.forEach(function (button) {
      var originalLabel = button.textContent;
      var targetId = button.getAttribute('data-copy-target');
      if (!targetId) return;

      button.addEventListener('click', function () {
        var target = document.getElementById(targetId);
        if (!target) return;

        var keywordNodes = target.querySelectorAll('li.keyword-pool code');
        if (!keywordNodes.length) {
          keywordNodes = target.querySelectorAll('code');
        }

        var keywordLines = Array.prototype.slice.call(keywordNodes)
          .map(function (node) { return node.textContent.trim(); })
          .filter(function (text) { return text.length > 0; });

        if (!keywordLines.length) return;

        writeToClipboard(keywordLines.join('\n'))
          .then(function () {
            button.classList.add('copied');
            button.textContent = 'Copied (' + keywordLines.length + ')';
            window.setTimeout(function () {
              button.classList.remove('copied');
              button.textContent = originalLabel;
            }, 1600);
          })
          .catch(function () {
            button.textContent = 'Copy failed';
            window.setTimeout(function () {
              button.textContent = originalLabel;
            }, 1600);
          });
      });
    });
  }

  function onScroll() {
    if (!topBtn) return;
    topBtn.classList.toggle('visible', window.scrollY > 350);
  }
  if (topBtn) {
    topBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  setupDropdowns();
  setupKeywordCopyButtons();
  onScroll();
})();
