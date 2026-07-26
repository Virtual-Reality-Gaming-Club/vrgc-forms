'use client';

// Audio engine disabled per user request
class CyberAudioEngine {
  public toggleMute(): boolean {
    return true;
  }

  public getMuted(): boolean {
    return true;
  }

  public loadCustomMusic(_mp3Url: string) {}

  public startBackgroundMusic() {}

  public stopBackgroundMusic() {}

  public playIntroBoom() {}

  public playShuffleTick() {}

  public playCardPick() {}

  public playCardFlip() {}

  public playRevealChime() {}
}

export const cyberAudio = new CyberAudioEngine();
