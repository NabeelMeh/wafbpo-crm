# Worker templates - review before use

These units are source examples, not installed services. Install Node dependencies and ClamAV/signature updates on a private host. Create the service users, put code in the configured absolute directory and use restricted local .env.local files. Replace /usr/bin/npm and PATH with the actual installed binary paths. The scanner only needs its application URL, scan secret and ClamAV settings; do not give it database/data keys. The purge worker needs a separate environment and destructive object-version permissions; do not grant these to the web runtime.

After reviewing units on the target system, install them in /etc/systemd/system, reload the daemon, and enable/start cloudnest-scanner.timer. Check actual service logs and a successful empty-queue heartbeat before uploading. Run the purge unit only under an approved deletion/retention schedule. ClamAV/freshclam installation and signature-update service are managed separately. Files remain quarantined on errors.

Systemd unit syntax and live service operation have not been tested here. Staging verification is mandatory.
