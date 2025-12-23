export function isProbablyEncoded(value: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(value);
}

export function splitPathAndSuffix(input: string): { path: string; suffix: string } {
  const queryIndex = input.indexOf("?");
  const hashIndex = input.indexOf("#");
  
  let splitIndex = -1;
  if (queryIndex !== -1 && hashIndex !== -1) {
    splitIndex = Math.min(queryIndex, hashIndex);
  } else if (queryIndex !== -1) {
    splitIndex = queryIndex;
  } else if (hashIndex !== -1) {
    splitIndex = hashIndex;
  }
  
  if (splitIndex === -1) {
    return { path: input, suffix: "" };
  }
  
  return {
    path: input.slice(0, splitIndex),
    suffix: input.slice(splitIndex),
  };
}

export function safePublicUrl(input?: string): string {
  if (!input || input.trim() === "") {
    return "";
  }
  
  if (input.startsWith("data:") || input.startsWith("blob:")) {
    return input;
  }
  
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input;
  }
  
  if (input.startsWith("/")) {
    const { path, suffix } = splitPathAndSuffix(input);
    
    if (isProbablyEncoded(path)) {
      return input;
    }
    
    const encodedPath = encodeURI(path);
    return encodedPath + suffix;
  }
  
  return input;
}
