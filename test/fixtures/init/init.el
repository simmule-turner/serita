; ==========================================
; 2026-11-09 - load global.el              =
; 2026-11-08 - load holidays and templates =
; 2026-11-06 - initial version             =
; ==========================================

; Global variables
(load "github:org/globals.el")

; Agenda
(setq org-agenda-files '("github:home.org" "github:journal.org" "github:calendar.org"))

; Contacts
(setq org-contacts-files '("github:contacts.org"))

; Refile targets
(setq org-refile-targets '((org-agenda-files :maxlevel . 2) (nil :maxlevel . 3)))

; Diary
(setq org-agenda-include-diary t diary-file "github:diary")

; Holidays
(load "github:org/holidays.el")

; Capture templates
(load "github:org/templates.el")

; Weather
(setq org-weather-format "Weather: %icon, %tcur (%tmin-%tmax) %tu, %p%pu, %h%hu, %s%su (%a%au)")
