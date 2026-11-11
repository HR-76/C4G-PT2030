async function rollbackReleaseAndThrow(client, primaryError, message) {
  let rollbackError = null;
  try {
    await client.query('ROLLBACK');
  } catch (error) {
    rollbackError = error;
  }

  if (rollbackError) {
    const errors = [primaryError, rollbackError];
    try {
      client.release(rollbackError);
    } catch (releaseError) {
      errors.push(releaseError);
    }
    throw new AggregateError(errors, message, { cause: primaryError });
  }

  try {
    client.release();
  } catch (releaseError) {
    throw new AggregateError([primaryError, releaseError], message, { cause: primaryError });
  }
  throw primaryError;
}

module.exports = { rollbackReleaseAndThrow };
