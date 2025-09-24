import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

type OrderItem = {
  name: string;
  quantity: number;
  price: number | string;
};

type OrderConfirmedEmailProps = {
  orderNumber: string | number;
  customerName: string;
  total: number | string;
  items: OrderItem[];
  supportEmail: string;
};

const formatAmount = (value: number | string) =>
  typeof value === "number" ? `$${value.toFixed(2)}` : value;

const containerStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "640px",
  margin: "0 auto",
  padding: "40px 32px",
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
};

const bodyStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: 0,
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  color: "#0f172a",
};

const headingStyle: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: "0 0 16px",
};

const paragraphStyle: React.CSSProperties = {
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 16px",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const tableHeaderStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 0",
  fontSize: "14px",
  color: "#475569",
  borderBottom: "1px solid #e2e8f0",
};

const tableCellStyle: React.CSSProperties = {
  padding: "12px 0",
  fontSize: "15px",
  borderBottom: "1px solid #e2e8f0",
};

const totalLabelStyle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  textAlign: "right",
  paddingRight: "8px",
};

const totalValueStyle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  color: "#0f172a",
};

const linkStyle: React.CSSProperties = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 600,
};

const OrderConfirmedEmail: React.FC<OrderConfirmedEmailProps> = ({
  orderNumber,
  customerName,
  total,
  items,
  supportEmail,
}) => (
  <Html>
    <Head />
    <Preview>{`Confirmación de compra #${orderNumber}`}</Preview>
    <Body style={bodyStyle}>
      <Container style={containerStyle}>
        <Section>
          <Heading style={headingStyle}>{`¡Gracias por tu compra, ${customerName}!`}</Heading>
          <Text style={paragraphStyle}>
            Hemos recibido tu pedido #{orderNumber}. A continuación encontrarás el resumen
            de los artículos incluidos en tu compra.
          </Text>
        </Section>

        <Section>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...tableHeaderStyle, width: "50%" }}>Producto</th>
                <th style={{ ...tableHeaderStyle, width: "25%" }}>Cantidad</th>
                <th style={{ ...tableHeaderStyle, width: "25%", textAlign: "right" }}>
                  Precio
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.name}-${item.quantity}-${item.price}`}>
                  <td style={tableCellStyle}>{item.name}</td>
                  <td style={tableCellStyle}>{item.quantity}</td>
                  <td style={{ ...tableCellStyle, textAlign: "right" }}>
                    {formatAmount(item.price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section>
          <table style={{ width: "100%" }}>
            <tbody>
              <tr>
                <td style={totalLabelStyle}>Total</td>
                <td style={totalValueStyle}>{formatAmount(total)}</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Hr style={{ borderColor: "#e2e8f0", margin: "32px 0" }} />

        <Section>
          <Text style={paragraphStyle}>
            Si tenés alguna consulta, no dudes en escribirnos a {" "}
            <Link href={`mailto:${supportEmail}`} style={linkStyle}>
              {supportEmail}
            </Link>
            .
          </Text>
          <Text style={{ ...paragraphStyle, marginBottom: 0 }}>— Equipo NERIN</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export default OrderConfirmedEmail;
