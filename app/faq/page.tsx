'use client';

import { useState } from 'react';

type FaqItem = {
  question: string;
  answer: string;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    question: '¿Cómo puedo realizar un pedido?',
    answer:
      'Para realizar un pedido elegí los productos que necesitás, agregalos al carrito y seguí los pasos del checkout para completar la compra.',
  },
  {
    question: '¿Cuáles son los métodos de pago disponibles?',
    answer:
      'Aceptamos tarjetas de crédito, débito y pagos a través de Mercado Pago para que elijas la opción que más te convenga.',
  },
  {
    question: '¿Hacen envíos a todo el país?',
    answer:
      'Sí, realizamos envíos a todo el territorio nacional utilizando servicios logísticos confiables para que tu pedido llegue seguro.',
  },
];

export default function FAQPage(): JSX.Element {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const handleToggle = (index: number) => {
    setActiveIndex((currentIndex) => (currentIndex === index ? null : index));
  };

  return (
    <main className="faq-page">
      <h1>Preguntas frecuentes</h1>
      <ul>
        {FAQ_ITEMS.map((item, index) => {
          const isActive = activeIndex === index;

          return (
            <li key={item.question} className={isActive ? 'faq-item active' : 'faq-item'}>
              <button type="button" onClick={() => handleToggle(index)}>
                {item.question}
              </button>
              {isActive ? <p>{item.answer}</p> : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
