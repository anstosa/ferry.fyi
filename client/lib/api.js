const API_BASE_URL = '/api';
export const get = async (path) => {
    const response = await fetch(`${API_BASE_URL}${path}`);
    return response.json();
};
export const post = async (path, data) => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
    return response.json();
};
