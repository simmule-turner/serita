;============================
; Capture templates         =
; Last modified: 2026-11-09 =
;============================


; Appointment
(defun my-year-heading ()
  "Find or create the heading of this year and leave point on it."
  (let ((year (format-time-string "%Y")))
    (goto-char (point-min))
    (unless (re-search-forward (format "^\\* %s\\(?: .*\\)?$" (regexp-quote year)) nil t)
      (goto-char (point-max))
      (unless (bolp) (insert "\n"))
      (insert "* " year "\n")
      (forward-line -1))
    (beginning-of-line)))

(add-to-list 'org-capture-templates
  '("a" "Appointment" entry (file+function "calendar.org" my-year-heading)
    "* %^{Description} %^T\n%?"))
; ========


; VCARD
(defun my-vcard-drop-empty ()
  "Drop the empty fields of a captured vCard, and an empty trailing tag."
  (goto-char (point-min))
  (when (re-search-forward "[ \t]+:+[ \t]*$" (line-end-position) t)
    (replace-match ""))
  (goto-char (point-min))
  (flush-lines "^[A-Za-z][A-Za-z0-9_-]*\\(;[^:\n]*\\)?:[; \t]*$"))

(add-to-list 'org-capture-templates
  '("v" "vCard Contact" entry (file+olp "github:contacts.org" "New")
    "* %^{First Name} %^{Last Name} :%^{Category/Tag}:\nBEGIN:VCARD\nVERSION:3.0\nFN:%\\1 %\\2\nN:%\\2;%\\1;;;\nEMAIL:%^{Email}\nTEL;TYPE=voice:%^{Phone Number}\nTEL;TYPE=cell:%^{Mobile Number}\nADR;TYPE=home:;;%^{Street};%^{City};%^{State};%^{Postal Code};%^{Country}\nBDAY:%^{Birthday (YYYY-MM-DD)}\nNOTE:%^{Note}\nORG:%^{Company/Organization}\nTITLE:%^{Job Title}\nEND:VCARD\n\n%?"
    :prepare-finalize my-vcard-drop-empty))
; ========

; Journal/Journal-checkitem
(defun my-olp-target (names)
  "Find or create the outline path NAMES in the file and leave point on its last heading.
A heading that has to be created goes first among its siblings (newest on top) when the template says :prepend, else last."
  (let ((level 1) (start (point-min)) (end (point-max)) (prepend t))
    (dolist (name names)
      (goto-char start)
      (if (re-search-forward (format "^\\*\\{%d\\} \\(?:[A-Z]+ \\)?\\(?:\\[#[A-Z0-9]\\] \\)?%s\\(?: +\\[[0-9/%%]*\\]\\)?\\(?:[ \t]+:[[:alnum:]_@#%%:]+:\\)?[ \t]*$" level (regexp-quote name)) end t)
          (setq start (1+ (match-end 0)))
        (goto-char start)
        (goto-char (if (and prepend (re-search-forward "^\\*+ " end t)) (match-beginning 0) end))
        (unless (bolp) (insert "\n"))
        (insert (make-string level ?*) " " name "\n")
        (setq start (point)))
      (goto-char start)
      (setq end (if (re-search-forward (format "^\\*\\{1,%d\\} " level) nil t) (match-beginning 0) (point-max)))
      (setq level (1+ level)))
    (goto-char start) (forward-line -1) (beginning-of-line)))

(defun my-journal-target ()
  "The day of today in the month of today in the journal."
  (my-olp-target (list "📔 Journal - journal and diary"
                       (format-time-string "%Y-%m %b")
                       (format-time-string "%Y-%m-%d"))))

(add-to-list 'org-capture-templates
  '("j" "Journal" item (file+function "github:home.org" my-journal-target) "%<%H:%M> - %?" :prepend nil))
(add-to-list 'org-capture-templates
  '("c" "Journal check item" checkitem (file+function "github:home.org" my-journal-target) "%?" :prepend nil))
; ========


; Tracking
(defun my-tracking-target ()
  "Find or create Bag > Health > Tracking > this month and leave point on that heading.
A new heading goes first among its siblings; a new month also gets the plot, the table and its formulas."
  (let ((level 1) (start (point-min)) (end (point-max)))
    (dolist (name (list "🛍️ Bag - lists and notes" "❤️ Health" "🏩 Tracking" (format-time-string "%Y-%m")))
      (goto-char start)
      (if (re-search-forward (format "^\\*\\{%d\\} %s[ \t]*$" level (regexp-quote name)) end t)
          (setq start (1+ (match-end 0)))
        (goto-char start)
        (goto-char (if (re-search-forward "^\\*+ " end t) (match-beginning 0) end))
        (unless (bolp) (insert "\n"))
        (insert (make-string level ?*) " " name "\n")
        (when (= level 4)
          (insert "#+PLOT: title:\"Tracking\" ind:4 deps:1 with:points ticks:6\n|   |\n|---|\n"
                  "#+TBLFM: $1=@#-1 :: $4=if(round(trunc($3/100) + 100*($3/100 - trunc($3/100)) / 60) == 24, 0, round(trunc($3/100) + 100*($3/100 - trunc($3/100)) / 60))\n"))
        (setq start (save-excursion (re-search-backward (format "^\\*\\{%d\\} " level)) (forward-line 1) (point))))
      (goto-char start)
      (setq end (if (re-search-forward (format "^\\*\\{1,%d\\} " level) nil t) (match-beginning 0) (point-max)))
      (setq level (1+ level)))
    (goto-char start) (forward-line -1) (beginning-of-line)))

(add-to-list 'org-capture-templates
  '("t" "Tracking" table-line (file+function "github:home.org" my-tracking-target)
     "| | %<%Y-%m-%d> | %<%H%M> ||"))
; ========


(add-to-list 'org-capture-templates
  '("m" "Meeting" plain (file+olp "github:home.org" "📥 Inbox - unprocessed" "Meeting Notes")
     "* %^{Meeting Title} :meeting:\n:PROPERTIES:\n:CREATED: %U\n:END:\n** Attendees\n- %?\n** Notes\n- \n** Action Items\n*** TODO [#A] %^{Top Priority Task}"
     :prepend t))

(add-to-list 'org-capture-templates
  '("w" "Web page or text" plain (file+headline "github:home.org" "📥 Inbox - unprocessed")
    "* %a%^{Title (leave blank for a web page)}\n:PROPERTIES:\n:CREATED: %U\n:END:\n  %i\n  %?"
    :empty-lines 1))
