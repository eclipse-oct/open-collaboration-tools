import { defineConfig } from 'vite';
import * as path from 'path';

export default defineConfig(() => {
    const config = {
        build: {
            target: 'esnext',
            rollupOptions: {
                input: {
                    index: path.resolve(__dirname, 'index.html'),
                }
            }
        }
    };
    return config;
});
