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

type PaymentPendingEmailProps = {
  orderNumber: string | number;
  customerName: string;
  supportEmail: string;
};

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

const linkStyle: React.CSSProperties = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 600,
};

const PaymentPendingEmail: React.FC<PaymentPendingEmailProps> = ({
  orderNumber,
  customerName,
  supportEmail,
}) => (
  <Html>
    <Head />
    <Preview>{`Pago pendiente para la orden #${orderNumber}`}</Preview>
    <Body style={bodyStyle}>
      <Container style={containerStyle}>
        <Section>
          <Heading style={headingStyle}>{`¡Gracias por tu compra, ${customerName}!`}</Heading>
          <Text style={paragraphStyle}>
            Recibimos tu pedido #{orderNumber} y actualmente estamos revisando el
            estado del pago. Este proceso puede demorar unos minutos.
          </Text>
          <Text style={paragraphStyle}>
            Te avisaremos por correo cuando la transacción se confirme. Si
            necesitás continuar con tu compra de manera inmediata, podés seguir
            revisando tus productos mientras aguardás la confirmación.
          </Text>
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

export default PaymentPendingEmail;
