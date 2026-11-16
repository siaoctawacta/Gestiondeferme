/** With `MAX_PRICE`, a line can reach 10^12: the cap of a document's total (`MAX_PAYMENT`) is what keeps amounts inside Decimal(14,2). */
export const MAX_QUANTITY = 1_000_000;
export const MAX_PRICE = 1_000_000;
/** The largest total or payment of a document: under Decimal(14,2), and safe as a JS number. */
export const MAX_PAYMENT = 999_999_999_999.99;
export const MAX_LINES = 100;
