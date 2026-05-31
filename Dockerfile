FROM nodered/node-red:latest

USER root

# Copy the custom node source
COPY --chown=node-red:node-red . /usr/src/node-red-contrib-hoymiles-home/

# Install the node's own dependencies (axios etc.)
RUN cd /usr/src/node-red-contrib-hoymiles-home && npm install --production --no-fund

# Bootstrap the Node-RED data dir and install the custom node into it.
# Named volumes are initialised from the image on first run, so npm packages
# installed here survive container restarts without a rebuild.
RUN cd /data && \
    echo '{"name":"nodered-data","private":true}' > package.json && \
    npm install /usr/src/node-red-contrib-hoymiles-home --no-fund --no-save && \
    chown -R node-red:node-red /data

# Copy dev settings and sample flows (only applied when /data volume is fresh)
COPY --chown=node-red:node-red docker/settings.js /data/settings.js
COPY --chown=node-red:node-red docker/flows.json   /data/flows.json

USER node-red
