const MAX_HISTORY_RANGE_MS = 2 * 366 * 24 * 60 * 60 * 1000;

const BUCKET_SIZES_SECONDS = [
  60, 300, 600, 900, 1800, 3600, 7200,
  21600, 43200, 86400, 172800, 604800, 1209600
];

function parseWibDateTime(value) {
  const match = String(value || '').match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
  );
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const validationDate = new Date(Date.UTC(year, month - 1, day, hour, minute));

  if (
    validationDate.getUTCFullYear() !== year ||
    validationDate.getUTCMonth() !== month - 1 ||
    validationDate.getUTCDate() !== day ||
    validationDate.getUTCHours() !== hour ||
    validationDate.getUTCMinutes() !== minute
  ) {
    return null;
  }

  const utcMs = Date.UTC(year, month - 1, day, hour - 7, minute);
  return {
    input: `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}`,
    sql: `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}:00`,
    utcMs
  };
}

function chooseBucketSeconds(durationMs) {
  const targetBucketSeconds = Math.max(60, Math.ceil(durationMs / 1000 / 360));
  return BUCKET_SIZES_SECONDS.find(size => size >= targetBucketSeconds)
    || BUCKET_SIZES_SECONDS[BUCKET_SIZES_SECONDS.length - 1];
}

function resolveCustomHistoryRange(query) {
  const hasCustomRange = query.start !== undefined || query.end !== undefined;
  if (!hasCustomRange) return null;

  const start = parseWibDateTime(query.start);
  const end = parseWibDateTime(query.end);
  if (!start || !end) {
    const error = new Error('Tanggal mulai dan selesai wajib diisi dengan format yang benar');
    error.statusCode = 400;
    throw error;
  }

  const durationMs = end.utcMs - start.utcMs;
  if (durationMs <= 0) {
    const error = new Error('Waktu selesai harus setelah waktu mulai');
    error.statusCode = 400;
    throw error;
  }
  if (durationMs > MAX_HISTORY_RANGE_MS) {
    const error = new Error('Rentang khusus maksimal 2 tahun');
    error.statusCode = 400;
    throw error;
  }

  return {
    rangeKey: 'custom',
    start,
    end,
    bucketSeconds: chooseBucketSeconds(durationMs)
  };
}

module.exports = {
  resolveCustomHistoryRange
};
