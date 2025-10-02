jest.mock('../db', () => ({
  getPool: jest.fn(),
}));

const db = require('../db');
const ordersRepo = require('../data/ordersRepo');

describe('ordersRepo.markEmailSent', () => {
  beforeEach(() => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: 'NRN-140925-1005',
          emails: { confirmedSent: true },
        },
      ],
    });
    db.getPool.mockReturnValue({ query });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('actualiza la orden usando order_number cuando no hay id numérico', async () => {
    const pool = db.getPool();

    await expect(
      ordersRepo.markEmailSent('NRN-140925-1005', 'confirmedSent', true),
    ).resolves.toEqual(
      expect.objectContaining({ emails: expect.objectContaining({ confirmedSent: true }) }),
    );

    expect(pool.query).toHaveBeenCalledWith(
      "UPDATE orders SET emails = COALESCE(emails, '{}'::jsonb) || $2::jsonb WHERE id=$1 OR order_number=$1 OR external_reference=$1 RETURNING *",
      ['NRN-140925-1005', JSON.stringify({ confirmedSent: true })],
    );
  });
});
