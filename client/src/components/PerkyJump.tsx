export function PerkyJump() {
  return (
    <div className="w-full h-full rounded-2xl overflow-hidden border border-black/10">
      <iframe
        src="https://perky.up.railway.app"
        className="w-full h-full border-0"
        title="Perky Jump"
        loading="lazy"
        allow="fullscreen"
      />
    </div>
  );
}
