# Worker templates - review before use

These units are source examples, not installed services. The external ClamAV scanner has been removed; file verification now runs inside the application during upload completion.

Deletions now purge stored file versions straight away. cloudnest-purge.service is an optional catch-up job for purges that were deferred by a storage error. It needs a separate environment with destructive object-version permissions; do not grant these to the web runtime. Create the service user, put code in the configured absolute directory, use a restricted local .env.local file, and replace /usr/bin/npm and PATH with the actual installed binary paths.

Systemd unit syntax and live service operation have not been tested here. Staging verification is mandatory.
