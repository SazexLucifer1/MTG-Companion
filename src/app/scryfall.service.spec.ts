import { TestBed } from '@angular/core/testing';
import { ScryfallService } from './scryfall.service';

describe('ScryfallService', () => {
  let service: ScryfallService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ScryfallService);
  });

  it('filters draft sets by query and year from the Scryfall API response', async () => {
    spyOn(globalThis, 'fetch').and.returnValue(
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { id: '1', code: 'm10', name: 'Magic 2010', released_at: '2009-07-17' },
              { id: '2', code: 'znr', name: 'Zendikar Rising', released_at: '2020-09-25' },
            ],
          }),
        ) as Response,
      ),
    );

    const results = await service.searchSets('magic', 2009);

    expect(results.map((set) => set.code)).toEqual(['m10']);
  });
});
