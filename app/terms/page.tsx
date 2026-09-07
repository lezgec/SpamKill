import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos del servicio — SpamKill",
  description: "Términos del servicio de SpamKill.",
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <nav className="legal-nav">
        <Link className="legal-brand" href="/">Spam<span>Kill</span></Link>
        <Link href="/privacy">Privacidad</Link>
      </nav>
      <article className="legal-card">
        <p className="legal-eyebrow">SpamKill</p>
        <h1>Términos del servicio</h1>
        <p className="legal-updated">Última actualización: 7 de septiembre de 2026</p>

        <h2>1. Descripción del servicio</h2>
        <p>SpamKill ayuda a revisar, clasificar y organizar mensajes de correo electrónico. Puedes analizar remitentes, revisar mensajes, solicitar desuscripciones y mover mensajes a la papelera.</p>

        <h2>2. Uso de cuentas de correo</h2>
        <p>Para utilizar Gmail o Outlook debes autorizar el acceso mediante el proveedor correspondiente. Cada proveedor se conecta y se administra de forma independiente. SpamKill no solicita ni almacena tu contraseña de correo.</p>

        <h2>3. Acciones sobre mensajes</h2>
        <p>Tú decides qué remitentes o mensajes seleccionar. Las acciones de desuscripción y traslado a la papelera pueden depender del proveedor y de las políticas del remitente. Revisa las confirmaciones antes de ejecutar una acción.</p>

        <h2>4. Clasificaciones</h2>
        <p>Las clasificaciones automáticas son orientativas y pueden equivocarse. Puedes corregirlas manualmente. Las correcciones agregadas de forma agregada pueden ayudar a mejorar la identificación de remitentes para otros usuarios.</p>

        <h2>5. Disponibilidad</h2>
        <p>El servicio puede cambiar, interrumpirse o dejar de estar disponible. No garantizamos que todos los mensajes, enlaces de desuscripción o proveedores sean compatibles en todo momento.</p>

        <h2>6. Contacto</h2>
        <p>Para preguntas sobre el servicio, escribe a <a href="mailto:zamgarluer@gmail.com">zamgarluer@gmail.com</a>.</p>
      </article>
    </main>
  );
}
