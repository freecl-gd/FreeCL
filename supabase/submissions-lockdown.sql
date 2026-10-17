-- Submissions now arrive only through the submit Edge Function, which verifies the
-- captcha. Leaving the direct insert open would make that captcha decorative.
revoke insert on submissions from authenticated;
drop policy submit on submissions;
