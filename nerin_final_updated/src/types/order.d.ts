export interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string | number;
  number: string | number;
  customerEmail: string;
  customerName: string;
  total: number;
  items: OrderItem[];
  emails?: {
    confirmedSent?: boolean;
    pendingSent?: boolean;
    rejectedSent?: boolean;
  };
}
