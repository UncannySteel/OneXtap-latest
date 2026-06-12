import { storage } from './storage';
import { APPLICATION_TYPES, DEFAULT_APPLICATION_TYPE } from './applicationTypes';

const APPLICATION_TYPE_KEY = 'onextap_application_type';

export async function getApplicationType() {
  const stored = await storage.get(APPLICATION_TYPE_KEY);
  if (stored && APPLICATION_TYPES.some((t) => t.id === stored)) {
    return stored;
  }
  return DEFAULT_APPLICATION_TYPE;
}

export async function setApplicationType(typeId) {
  if (!APPLICATION_TYPES.some((t) => t.id === typeId)) {
    throw new Error('Invalid application type');
  }
  await storage.set(APPLICATION_TYPE_KEY, typeId);
  return typeId;
}
