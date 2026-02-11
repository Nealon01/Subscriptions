@echo off
echo === YouTube Subs API Usage Log ===
echo.
if exist api-usage.log (
  type api-usage.log
  echo.
  echo === End of log ===
) else (
  echo No log file found yet. Start the server and make some API calls.
)
pause
