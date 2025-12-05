export function ok(res, body = {}) {
  return res.status(200).json({ success: true, ...body });
}

export function created(res, body = {}) {
  return res.status(201).json({ success: true, ...body });
}

export function badRequest(res, messageOrErrors = "Bad request") {
  if (Array.isArray(messageOrErrors)) {
    return res.status(400).json({ errors: messageOrErrors });
  }
  return res.status(400).json({ error: messageOrErrors });
}

export function unauthorized(res, message = "Unauthorized") {
  return res.status(401).json({ error: message });
}

export function forbidden(res, message = "Forbidden") {
  return res.status(403).json({ error: message });
}

export function notFound(res, message = "Not found") {
  return res.status(404).json({ error: message });
}

export function serverError(res, message = "Internal Server Error") {
  return res.status(500).json({ error: message });
}
