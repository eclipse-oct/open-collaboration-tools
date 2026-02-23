import { customAlphabet } from 'nanoid';

const ALPHANUMERIC_ALPHABET = (() => {
    let alphabet = '';
    for (let digit = 48 /* '0' */; digit <= 57 /* '9' */; digit++) {
        alphabet += String.fromCharCode(digit);
    }
    for (let letter = 65 /* 'A' */; letter <= 90 /* 'Z' */; letter++) {
        alphabet += String.fromCharCode(letter);
    }
    for (let letter = 97 /* 'a' */; letter <= 122 /* 'z' */; letter++) {
        alphabet += String.fromCharCode(letter);
    }
    return alphabet;
})();

export function generateSecureId(length: number): string {
    return customAlphabet(ALPHANUMERIC_ALPHABET, length)();
}
