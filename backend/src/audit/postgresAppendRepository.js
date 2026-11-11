class PostgresAppendRepository {
  async prepare(input, client) {
    if (!client || typeof client.query !== 'function') throw new TypeError('Audit append requires an explicit transaction client.');
    const { rows } = await client.query('SELECT * FROM audit.prepare_append_v1($1::uuid,$2::text)', [input.organizationId, input.streamType]);
    const row = rows[0];
    return Object.freeze({ duplicate: false, streamId: row.stream_id, sequence: Number(row.sequence), previousHash: row.previous_hash,
      acceptedAt: new Date(row.accepted_at).toISOString(), reservation: Object.freeze({ client }) });
  }
  async append({ event, inputDigest, reservation }) {
    const client = reservation && reservation.client;
    if (!client) throw new TypeError('Audit append reservation is invalid.');
    const { eventHash, ...material } = event;
    const actor = event.actor;
    const values = [event.eventId, event.source, event.eventCode, event.eventVersion, event.catalogVersion, event.auditClass,
      event.ledgerLocation, event.organizationId, event.tenantId, actor.type, actor.id, event.streamId, event.streamType,
      event.sequence, event.observedAt, event.acceptedAt, event.correlationId, event.causationId, event.idempotencyKey,
      inputDigest, event.previousHash, eventHash, JSON.stringify(material)];
    const placeholders = values.map((_, index) => `$${index + 1}`).join(',');
    const { rows } = await client.query(`SELECT * FROM audit.append_event_v1(${placeholders})`, values);
    return Object.freeze({ status: rows[0].status, eventId: rows[0].event_id, eventHash: rows[0].event_hash });
  }
}
module.exports = { PostgresAppendRepository };
