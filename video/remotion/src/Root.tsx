import { Composition } from "remotion";
import { Story } from "./Story";
import { END, FPS, SECTIONS } from "./data";
import { Close } from "./scenes/Graphics";

const EndCard = () => <Close start={SECTIONS.close} />;

export const Root = () => (
  <>
    <Composition id="Story" component={Story} durationInFrames={Math.round(END * FPS)} fps={FPS} width={1920} height={1080} />
    {/* The end card alone: for checking its layout with the demo and repo links filled in. */}
    <Composition id="EndCard" component={EndCard} durationInFrames={Math.round((END - SECTIONS.close) * FPS)} fps={FPS} width={1920} height={1080} />
  </>
);
