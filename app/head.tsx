export default function Head() {
  return (
    <>
      <title>W|E - Buz Card Extractor</title>
      <meta
        name="description"
        content="West End Workforce business card contact extractor."
      />

      {/* Favicons from /public */}
      <link rel="icon" type="image/png" sizes="32x32" href="/we-favicon-32.png?v=3" />
      <link rel="icon" type="image/png" sizes="16x16" href="/we-favicon-16.png?v=3" />

      {/* iOS Home Screen icon */}
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=3" />

      {/* Optional PWA manifest */}
      <link rel="manifest" href="/site.webmanifest" />

      <meta name="theme-color" content="#e31c79" />
    </>
  );
}