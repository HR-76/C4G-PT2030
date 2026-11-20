# The application itself remains byte-for-byte the supplied release candidate.
ARG CANDIDATE_IMAGE
FROM ${CANDIDATE_IMAGE}
USER root
COPY . /app/test/integration/production-bootstrap
USER node
CMD ["node", "/app/test/integration/production-bootstrap/docker.cjs", "run"]
