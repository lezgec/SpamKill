import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Declaración de privacidad — SpamKill",
  description: "Declaración de privacidad de SpamKill.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <nav className="legal-nav">
        <Link className="legal-brand" href="/">Spam<span>Kill</span></Link>
        <Link href="/terms">Términos del servicio</Link>
      </nav>
      <article className="legal-card">
        <p className="legal-eyebrow">SpamKill</p>
        <h1>Declaración de privacidad</h1>
        <p className="legal-updated">Última actualización: 7 de septiembre de 2026</p>

        <h2>1. Qué datos procesamos</h2>
        <p>SpamKill procesa el correo de la cuenta que conectes, incluyendo remitente, asunto, fecha, fragmento y encabezados necesarios para clasificar mensajes y detectar opciones de desuscripción.</p>

        <h2>2. Cómo usamos los datos</h2>
        <p>Usamos los datos para mostrar tu bandeja agrupada, aplicar tus preferencias, ejecutar acciones que solicites y mantener un historial de desuscripciones. No vendemos tu contenido ni lo usamos para publicidad.</p>

        <h2>3. Clasificaciones agregadas</h2>
        <p>Cuando corriges la categoría de un remitente, podemos guardar una señal asociada al remitente y a la cuenta para calcular una clasificación agregada. Esta señal no incluye el contenido del mensaje. Se requiere consenso de varias cuentas antes de usarla automáticamente para otros usuarios.</p>

        <h2>4. Almacenamiento y seguridad</h2>
        <p>En esta instalación local, los datos se almacenan en la base MySQL configurada por el administrador. Los tokens de acceso se guardan cifrados en cookies de sesión y se envían únicamente al proveedor de correo correspondiente cuando es necesario.</p>

        <h2>5. Proveedores externos</h2>
        <p>Gmail y Outlook procesan las solicitudes OAuth y las acciones de correo conforme a sus propias políticas. SpamKill no controla las políticas de Google o Microsoft.</p>

        <h2>6. Tus opciones</h2>
        <p>Puedes desconectar una cuenta, borrar tus datos locales y solicitar la eliminación de tus preferencias. Para ayuda o consultas de privacidad, escribe a <a href="mailto:zamgarluer@gmail.com">zamgarluer@gmail.com</a>.</p>
      </article>
    </main>
  );
}
