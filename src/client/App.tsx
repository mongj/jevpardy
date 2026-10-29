import { useEffect, useState } from "react";
import { Starfield } from "./components/Starfield.tsx";
import { saveName } from "./lib/identity.ts";
import { navigate, useRoute } from "./lib/router.ts";
import { unlockAudio } from "./lib/sfx.ts";
import { Home } from "./screens/Home.tsx";
import { Host } from "./screens/Host.tsx";
import { JoinGate } from "./screens/JoinGate.tsx";
import { RoomScreen } from "./screens/Room.tsx";

export function App() {
  const route = useRoute();
  const [warp, setWarp] = useState(false);

  useEffect(() => {
    const unlock = () => unlockAudio();
    addEventListener("pointerdown", unlock, { once: true });
    return () => removeEventListener("pointerdown", unlock);
  }, []);

  let screen;
  switch (route.name) {
    case "home":
      screen = <Home />;
      break;
    case "host":
      screen = <Host />;
      break;
    case "join":
      screen =
        route.code.length === 4 ? (
          <JoinGate
            code={route.code}
            onJoin={(name) => {
              saveName(name);
              navigate(`/r/${route.code}`, true);
            }}
          />
        ) : (
          <Home />
        );
      break;
    case "room":
      screen = <RoomScreen key={route.code} code={route.code} onWarp={setWarp} />;
      break;
    default: {
      const unknown: never = route;
      screen = <p>{String(unknown)}</p>;
    }
  }

  return (
    <>
      <Starfield warp={warp} />
      <div className="crt" aria-hidden="true" />
      {screen}
    </>
  );
}
