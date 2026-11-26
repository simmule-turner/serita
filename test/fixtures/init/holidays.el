; ===========================
; Holidays                  =
; Last modified: 2026-11-08 =
;============================

; Holidays - enable ones you want
(setq ;holiday-general-holidays nil
      ;holiday-christian-holidays nil
      holiday-hebrew-holidays nil
      holiday-islamic-holidays nil
      holiday-bahai-holidays nil
      holiday-oriental-holidays nil
      ;holiday-solar-holidays nil
      )

; Holidays that are not in above, yet!
(setq holiday-local-holidays
      '((holiday-fixed 3 14 "Pi Day")
        (holiday-fixed 6 19 "Juneteenth")))
