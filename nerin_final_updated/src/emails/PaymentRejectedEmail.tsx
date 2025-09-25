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

type PaymentRejectedEmailProps = {
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

const ctaStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "12px 24px",
  backgroundColor: "#2563eb",
  color: "#ffffff",
  borderRadius: "9999px",
  textDecoration: "none",
  fontWeight: 600,
  fontSize: "16px",
};

const PaymentRejectedEmail: React.FC<PaymentRejectedEmailProps> = ({
  orderNumber,
  customerName,
  supportEmail,
}) => (
  <Html>
    <Head />
    <Preview>{`Pago rechazado para la orden #${orderNumber}`}</Preview>
    <Body style={bodyStyle}>
      <Container style={containerStyle}>
        <Section>
          <Heading style={headingStyle}>{`Hola ${customerName}, hubo un problema con tu pago`}</Heading>
          <Text style={paragraphStyle}>
            Intentamos procesar el pago del pedido #{orderNumber}, pero la
            transacción fue rechazada por la entidad emisora.
          </Text>
          <Text style={paragraphStyle}>
            Podés reintentar el pago haciendo clic en el siguiente enlace o bien
            utilizando otro método de pago en el checkout.
          </Text>
          <Link href="#/checkout" style={ctaStyle}>
            Reintentar pago
          </Link>
        </Section>

        <Hr style={{ borderColor: "#e2e8f0", margin: "32px 0" }} />

        <Section>
          <Text style={paragraphStyle}>
            Si necesitás ayuda, escribinos a {" "}
            <Link href={`mailto:${supportEmail}`} style={linkStyle}>
              {supportEmail}
            </Link>
            . Nuestro equipo está disponible para asistirte.
          </Text>
          <Text style={{ ...paragraphStyle, marginBottom: 0 }}>— Equipo NERIN</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export default PaymentRejectedEmail;
