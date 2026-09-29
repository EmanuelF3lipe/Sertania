export { LinkSlaPolicyToServiceVersion1730000001000 } from './1730000001000-LinkSlaPolicyToServiceVersion';
import { LinkSlaPolicyToServiceVersion1730000001000 } from './1730000001000-LinkSlaPolicyToServiceVersion';
export { InitialSchema1730000000000 } from './1730000000000-InitialSchema';
import { InitialSchema1730000000000 } from './1730000000000-InitialSchema';
export { ServerOnboarding1730000002000 } from './1730000002000-ServerOnboarding';
import { ServerOnboarding1730000002000 } from './1730000002000-ServerOnboarding';
export { SessionSettings1730000003000 } from './1730000003000-SessionSettings';
import { SessionSettings1730000003000 } from './1730000003000-SessionSettings';
export const migrations = [
  InitialSchema1730000000000,
  LinkSlaPolicyToServiceVersion1730000001000,
  ServerOnboarding1730000002000,
  SessionSettings1730000003000,
];
