import { TestBed } from '@angular/core/testing';
import { PublicDeckService } from './public-deck.service';
import { supabase } from './supabase.client';

/**
 * Baut einen Fake-Query-Builder, der jede Filter-Methode (select/eq/ilike/contains/order/limit/
 * in/not) einfach an sich selbst zurückgibt (wie Supabase es tut) und am Ende mit der für die
 * jeweilige Tabelle vorgegebenen Antwort auflöst - reicht aus, um PublicDeckService's Mapping-/
 * Aggregationslogik zu testen, ohne die echte Supabase-Query-Builder-Kette nachzubauen.
 */
function mockSupabaseFrom(responses: Record<string, { data: any[] | null; error: unknown }>) {
  return vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
    const response = responses[table] ?? { data: [], error: null };
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      ilike: () => builder,
      contains: () => builder,
      order: () => builder,
      limit: () => builder,
      in: () => builder,
      not: () => builder,
      then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
    };
    return builder;
  });
}

describe('PublicDeckService', () => {
  let service: PublicDeckService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PublicDeckService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps decks, merges commander names, and computes win rate from deck_public_stats', async () => {
    mockSupabaseFrom({
      decks: {
        data: [
          {
            id: 'deck-1',
            name: 'Golgari Midrange',
            format: 'Commander',
            updated_at: '2026-08-20T00:00:00Z',
            edhrec_tag: 'aristocrats',
            color_identity: ['B', 'G'],
            commander_types: ['Elf'],
          },
        ],
        error: null,
      },
      deck_cards: {
        data: [{ deck_id: 'deck-1', card_name: 'Meren of Clan Nel Toth' }],
        error: null,
      },
      deck_public_stats: {
        data: [{ deck_id: 'deck-1', games: 4, wins: 3 }],
        error: null,
      },
    });

    const { decks, stats } = await service.searchPublicDecks({ sort: 'recent' });

    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({
      id: 'deck-1',
      name: 'Golgari Midrange',
      colorIdentity: ['B', 'G'],
      commanderTypes: ['Elf'],
      commanderNames: ['Meren of Clan Nel Toth'],
    });
    expect(stats.get('deck-1')).toEqual({ games: 4, wins: 3, winRate: 75 });
  });

  it('sorts by win rate (descending, tie-broken by more games) when sort is winRate', async () => {
    mockSupabaseFrom({
      decks: {
        data: [
          { id: 'low', name: 'Low winrate', format: null, updated_at: '2026-08-01T00:00:00Z', edhrec_tag: null, color_identity: [], commander_types: [] },
          { id: 'high', name: 'High winrate', format: null, updated_at: '2026-08-02T00:00:00Z', edhrec_tag: null, color_identity: [], commander_types: [] },
        ],
        error: null,
      },
      deck_cards: { data: [], error: null },
      deck_public_stats: {
        data: [
          { deck_id: 'low', games: 10, wins: 2 },
          { deck_id: 'high', games: 5, wins: 4 },
        ],
        error: null,
      },
    });

    const { decks } = await service.searchPublicDecks({ sort: 'winRate' });

    expect(decks.map((d) => d.id)).toEqual(['high', 'low']);
  });

  it('returns distinct, sorted archetype values', async () => {
    mockSupabaseFrom({
      decks: {
        data: [{ edhrec_tag: 'ramp' }, { edhrec_tag: 'aristocrats' }, { edhrec_tag: 'ramp' }],
        error: null,
      },
    });

    expect(await service.archetypeOptions()).toEqual(['aristocrats', 'ramp']);
  });
});
