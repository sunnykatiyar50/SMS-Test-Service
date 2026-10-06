#!/bin/sh
# Container entrypoint.
#
# The app runs as the unprivileged "node" user. Its data and log directories are often bind mounts
# (e.g. ./logs:/app/logs) that the host or Docker created as root, which node can't write to.
# When started as root (the default), fix the ownership of those directories, then drop to node.
# When started with --user / user:, run the command as that user unchanged.
set -e

if [ "$(id -u)" = "0" ]; then
    node_uid="$(id -u node)"
    for dir in "$(dirname "${SQLITE_PATH:-/app/data/sms-db.sqlite}")" "${LOG_DIR:-/app/logs}"; do
        mkdir -p "$dir"
        # Only walk the directory when its owner is wrong, so restarts stay fast
        if [ "$(stat -c %u "$dir")" != "$node_uid" ]; then
            echo "docker-entrypoint: giving node ownership of $dir"
            chown -R node:node "$dir"
        fi
    done
    exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
