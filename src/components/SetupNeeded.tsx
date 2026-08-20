const STEPS = [
  {
    title: "Crea un proyecto en Google Cloud",
    detail:
      "console.cloud.google.com › nuevo proyecto. El nombre que le pongas es el que verás en la pantalla de permisos.",
  },
  {
    title: "Activa la Google Drive API",
    detail: "APIs y servicios › Biblioteca › Google Drive API › Habilitar.",
  },
  {
    title: "Crea credenciales OAuth de tipo Web",
    detail:
      "Como origen autorizado pon http://localhost:3000 para desarrollo, y la URL de Vercel cuando despliegues. No necesitas el client secret.",
  },
  {
    title: "Copia .env.example a .env.local",
    detail:
      "Y pega el client ID en NEXT_PUBLIC_GOOGLE_CLIENT_ID. Es la única variable que hay.",
  },
];

export function SetupNeeded() {
  return (
    <main className="mx-auto w-full max-w-3xl grow px-6 py-16">
      <p className="t-label mb-3 text-accent">Configuración pendiente</p>

      <h1 className="t-display mb-4 text-4xl font-bold leading-none sm:text-5xl">
        Falta el client ID de Google
      </h1>

      <p className="mb-10 max-w-lg text-lg text-ink-soft">
        La app no guarda ningún secreto: el client ID es público y viaja en la
        página. Lo que protege tu cuenta es la lista de orígenes autorizados en
        Google Cloud.
      </p>

      <ol className="mb-10 border-t border-rule">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="grid grid-cols-[2.5rem_1fr] gap-x-4 border-b border-rule py-4"
          >
            <span className="pt-1 font-mono text-sm text-accent tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h2 className="t-display font-semibold">{step.title}</h2>
              <p className="text-[0.95rem] text-ink-soft">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="max-w-lg text-[0.95rem] text-ink-soft">
        Con el scope <code className="font-mono">drive.file</code> la app solo
        accede a los ficheros que ella crea, así que Google no exige la revisión
        de seguridad de los scopes amplios. Verás un aviso de «app no
        verificada» mientras el proyecto esté en modo de prueba.
      </p>
    </main>
  );
}
