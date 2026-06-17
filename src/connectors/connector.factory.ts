import { AppConfig } from '../config/config.service';
import { SourceType } from '../types/enums';
import { childLogger } from '../logger/logger.service';
import { BaseConnector } from './base.connector';
import { StripeConnector } from './stripe/stripe.connector';
import { HubSpotContactConnector, HubSpotDealConnector } from './hubspot/hubspot.connector';
import { GCalConnector } from './gcal/gcal.connector';

const log = childLogger({ component: 'connector.factory' });

export interface EnabledSource {
  source: SourceType;
  connector: BaseConnector<unknown>;
}

export class ConnectorFactory {
  static build(cfg: AppConfig): EnabledSource[] {
    const enabled: EnabledSource[] = [];

    if (cfg.STRIPE_ENABLED) {
      if (!cfg.STRIPE_API_KEY) throw new Error('STRIPE_ENABLED=true but STRIPE_API_KEY missing');
      enabled.push({
        source: SourceType.STRIPE,
        connector: new StripeConnector(cfg.STRIPE_API_KEY) as BaseConnector<unknown>,
      });
    }

    if (cfg.HUBSPOT_ENABLED) {
      if (!cfg.HUBSPOT_ACCESS_TOKEN)
        throw new Error('HUBSPOT_ENABLED=true but HUBSPOT_ACCESS_TOKEN missing');
      enabled.push({
        source: SourceType.HUBSPOT,
        connector: new HubSpotDealConnector(cfg.HUBSPOT_ACCESS_TOKEN) as BaseConnector<unknown>,
      });
      enabled.push({
        source: SourceType.HUBSPOT,
        connector: new HubSpotContactConnector(cfg.HUBSPOT_ACCESS_TOKEN) as BaseConnector<unknown>,
      });
    }

    if (cfg.GCAL_ENABLED) {
      if (!cfg.GOOGLE_CLIENT_EMAIL || !cfg.GOOGLE_PRIVATE_KEY)
        throw new Error('GCAL_ENABLED=true but GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY missing');
      enabled.push({
        source: SourceType.GCAL,
        connector: new GCalConnector(
          cfg.GOOGLE_CLIENT_EMAIL,
          cfg.GOOGLE_PRIVATE_KEY,
          cfg.GOOGLE_CALENDAR_ID,
        ) as BaseConnector<unknown>,
      });
    }

    log.info({ enabled: enabled.map((e) => `${e.source}:${e.connector.entity}`) }, 'connectors_built');
    return enabled;
  }
}
