# Minimal overlay: preserve the exact running API image and add only the 053 email fix.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /app/backend
COPY memberEmailAdmission.js ./src/security/memberEmailAdmission.js
COPY memberEmailRollout.js ./scripts/staging/memberEmailRollout.js
RUN node --check src/security/memberEmailAdmission.js && node --check scripts/staging/memberEmailRollout.js
LABEL c4g.patch="member-email-053-v1"
