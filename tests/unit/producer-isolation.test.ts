/**
 * Fault-isolation test: verifies that one source failing in runAll() does NOT
 * prevent the remaining sources from being processed.
 *
 * ProducerJob.runAll() iterates connectors and wraps each runOne() call in an
 * isolated try/catch. This test proves that contract holds even when a source
 * throws mid-run.
 */
import { ConfigService } from '../../src/config/config.service';
import { ProducerJob } from '../../src/jobs/producer.job';
import { CursorService } from '../../src/cursor/cursor.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { RunReportService } from '../../src/reports/run-report.service';
import { ConnectorFactory } from '../../src/connectors/connector.factory';
import { SourceType, EntityType, SyncMode } from '../../src/types/enums';
import { RunReportDraft } from '../../src/types/unified';

// Minimal env to satisfy ConfigService
beforeAll(() => {
  ConfigService.load({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    API_KEY: 'a'.repeat(32),
    ADMIN_API_KEY: 'b'.repeat(32),
    STRIPE_ENABLED: 'true',
    HUBSPOT_ENABLED: 'true',
    GCAL_ENABLED: 'true',
    STRIPE_API_KEY: 'sk_test_fake',
    HUBSPOT_ACCESS_TOKEN: 'fake-token',
    GOOGLE_CLIENT_EMAIL: 'sa@fake.iam.gserviceaccount.com',
    GOOGLE_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
    GOOGLE_CALENDAR_ID: 'primary',
  } as NodeJS.ProcessEnv);
});

function makeDraft(source: SourceType): RunReportDraft {
  return {
    runId: `run-${source}`,
    source,
    entity: EntityType.PAYMENTS,
    mode: SyncMode.INCREMENTAL,
    startedAt: new Date(),
    cursorBefore: null,
    cursorAfter: null,
    staleCursorDetected: false,
    fullBackfillTriggered: false,
    pagesFetched: 0,
    recordsFetched: 0,
    recordsUpserted: 0,
    recordsDeduped: 0,
    recordsFailed: 0,
    failedRecords: [],
    batches: [],
    unmappedStatusesSeen: [],
  };
}

describe('ProducerJob fault isolation', () => {
  let job: ProducerJob;
  let runOneSpy: jest.SpyInstance;

  beforeEach(() => {
    const cursors = {} as CursorService;
    const outbox = {} as OutboxService;
    const reports = {} as RunReportService;
    job = new ProducerJob(cursors, outbox, reports);
  });

  afterEach(() => {
    runOneSpy?.mockRestore();
    jest.restoreAllMocks();
  });

  it('continues processing remaining sources when one throws', async () => {
    // Arrange: 3 connectors, middle one causes runOne to throw
    const fakeConnectors = [
      { source: SourceType.STRIPE, connector: { source: SourceType.STRIPE, entity: EntityType.PAYMENTS } },
      { source: SourceType.HUBSPOT, connector: { source: SourceType.HUBSPOT, entity: EntityType.PAYMENTS } },
      { source: SourceType.GCAL, connector: { source: SourceType.GCAL, entity: EntityType.EVENTS } },
    ];
    jest.spyOn(ConnectorFactory, 'build').mockReturnValue(fakeConnectors as any);

    runOneSpy = jest
      .spyOn(job, 'runOne')
      .mockResolvedValueOnce(makeDraft(SourceType.STRIPE))
      .mockRejectedValueOnce(new Error('hubspot_api_500'))
      .mockResolvedValueOnce(makeDraft(SourceType.GCAL));

    // Act
    const drafts = await job.runAll();

    // Assert: stripe + gcal succeed; hubspot failure is swallowed, not propagated
    expect(runOneSpy).toHaveBeenCalledTimes(3);
    expect(drafts).toHaveLength(2);
    expect(drafts[0].source).toBe(SourceType.STRIPE);
    expect(drafts[1].source).toBe(SourceType.GCAL);
  });

  it('returns empty array when all sources throw', async () => {
    const fakeConnectors = [
      { source: SourceType.STRIPE, connector: { source: SourceType.STRIPE, entity: EntityType.PAYMENTS } },
    ];
    jest.spyOn(ConnectorFactory, 'build').mockReturnValue(fakeConnectors as any);
    runOneSpy = jest.spyOn(job, 'runOne').mockRejectedValue(new Error('total_failure'));

    const drafts = await job.runAll();

    expect(drafts).toHaveLength(0);
    // runAll itself must NOT throw — it absorbs all errors
  });

  it('returns all drafts when no sources fail', async () => {
    const fakeConnectors = [
      { source: SourceType.STRIPE, connector: {} },
      { source: SourceType.HUBSPOT, connector: {} },
    ];
    jest.spyOn(ConnectorFactory, 'build').mockReturnValue(fakeConnectors as any);
    runOneSpy = jest
      .spyOn(job, 'runOne')
      .mockResolvedValueOnce(makeDraft(SourceType.STRIPE))
      .mockResolvedValueOnce(makeDraft(SourceType.HUBSPOT));

    const drafts = await job.runAll();

    expect(drafts).toHaveLength(2);
  });
});
