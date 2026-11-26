; =========================
; Global variables        =
; Last update: 2026-11-09 =
;==========================

(setq calendar-time-display-form '(24-hours ":" minutes)
      display-line-numbers-mode nil
      display-time-format "%H:%M"
      display-time-mode t
      org-babel-load-languages '((emacs-lisp . t) (js . t))
      org-cycle-open-archived-trees t
      org-log-done 'time
      org-startup-truncated nil
      org-startup-with-inline-images t
      org-use-sub-superscripts '{}
      org-weather-refresh-interval 2
      org-tags-column 0
      calendar-latitude 35.994        ; Durham, NC
      calendar-longitude -78.8986
      org-startup-indented t
      org-xx-extensions 'on
      org-xx-startup-with-show-photos t)

(setq org-xx-extra-menu
      '("a;📅 Appointment"
        "j;📔 Journal"
        "c;✅ Checklist"
        "-----"
        "t;⭐ Tracking"
        "[\"🛍️ Bag - lists and notes\", \"❤️ Health\", \"🏩 Tracking\", \"%<%Y-%m>\"];👁 Current"
        "-----"
        "'calendar;🗓️ Calendar"
        "v;📇 vCard"))

(setq org-xx-menu-aliases
      '("more:Commands;💲Commands"
        "more:Export;📤 Export"
        "more:Import;📥 Import"
        "more:Settings;⚙️ Settings"))
