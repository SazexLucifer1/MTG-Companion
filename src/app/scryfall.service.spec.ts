import { TestBed } from '@angular/core/testing';
import { ScryfallService } from './scryfall.service';

describe('ScryfallService', () => {
  let service: ScryfallService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ScryfallService);
  });

  afterEach(() => {
    // vi.spyOn() reuses an existing spy instead of creating a fresh one if globalThis.fetch is
    // already mocked - without restoring here, later tests would inherit earlier tests' call
    // history (and mocked response) instead of starting clean.
    vi.restoreAllMocks();
  });

  it('filters draft sets by query and year from the Scryfall API response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: '1', code: 'm10', name: 'Magic 2010', released_at: '2009-07-17', set_type: 'core' },
            { id: '2', code: 'znr', name: 'Zendikar Rising', released_at: '2020-09-25', set_type: 'expansion' },
          ],
        }),
      ) as Response,
    );

    const results = await service.searchSets('magic', 2009);

    expect(results.map((set) => set.code)).toEqual(['m10']);
  });

  it('builds an exact color-identity query for searchCommanders', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] })) as Response);

    await service.searchCommanders(['W', 'U']);

    const calledUrl = fetchSpy.mock.calls.at(-1)![0] as string;
    expect(decodeURIComponent(calledUrl)).toContain('is:commander id=WU');
  });

  it('AND-composes name, archetype, and creature-type filters in searchCommanders', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] })) as Response);

    await service.searchCommanders(['G'], {
      name: 'Elf',
      archetypeQuery: 'otag:counters-matter',
      creatureType: 'Elf',
    });

    const calledUrl = fetchSpy.mock.calls.at(-1)![0] as string;
    expect(decodeURIComponent(calledUrl)).toContain(
      'is:commander id=G name:"Elf" otag:counters-matter (t:"Elf" or o:"Elf")',
    );
  });

  it('omits the color-identity clause in searchCommanders when no colors are selected', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] })) as Response);

    await service.searchCommanders([], { archetypeQuery: 'otag:landfall' });

    const calledUrl = fetchSpy.mock.calls.at(-1)![0] as string;
    expect(decodeURIComponent(calledUrl)).toContain('is:commander otag:landfall');
    expect(decodeURIComponent(calledUrl)).not.toContain('id=');
  });

  describe('creatureTypes', () => {
    it('parses and caches the creature-type catalog', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            object: 'catalog',
            uri: 'https://api.scryfall.com/catalog/creature-types',
            total_values: 2,
            data: ['Zombie', 'Elf'],
          }),
        ) as Response,
      );

      const first = await service.creatureTypes();
      expect(first).toEqual(['Elf', 'Zombie']);

      const second = await service.creatureTypes();
      expect(second).toEqual(['Elf', 'Zombie']);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array when the catalog request fails', async () => {
      // status 404 statt 500: fetchWithRetry() behandelt 404 als "gültige, sofortige Antwort ohne
      // Wiederholung" (siehe scryfall.service.ts) - ein echter 5xx-Fehlschlag würde hier reale
      // Sleeps zwischen den Wiederholungsversuchen auslösen und den Test unnötig verlangsamen.
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }) as Response);
      expect(await service.creatureTypes()).toEqual([]);
    });
  });
});
